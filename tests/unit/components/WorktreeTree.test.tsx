import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@tanstack/react-virtual", () => ({
	useVirtualizer: (options: { count: number }) => ({
		getTotalSize: () => options.count * 24,
		getVirtualItems: () =>
			Array.from({ length: options.count }, (_, i) => ({
				index: i,
				start: i * 24,
				size: 24,
				key: String(i),
			})),
		measureElement: () => 0,
	}),
}));

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		listWorktree: vi.fn(),
	},
}));

import { WorktreeTree } from "../../../src/features/viewer/components/WorktreeTree";
import { files } from "../../../src/lib/desktop-client";

const mockListWorktree = vi.mocked(files.listWorktree);

function wrapEntries(paths: string[]) {
	return paths.map((p) => ({ path: p, ignored: false }));
}

function renderTree(
	overrides: Partial<React.ComponentProps<typeof WorktreeTree>> = {},
) {
	return render(
		<WorktreeTree
			workspaceId="ws-1"
			worktreeId="wt-1"
			worktreeLabel="repo"
			selectedFile={null}
			onSelect={vi.fn()}
			changedFiles={[]}
			expandedPaths={[]}
			onExpandedPathsChange={vi.fn()}
			showIgnored={false}
			onToggleShowIgnored={vi.fn()}
			{...overrides}
		/>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("WorktreeTree basic states", () => {
	it("shows a loading message while files are being fetched", () => {
		mockListWorktree.mockReturnValue(new Promise(() => {}));
		renderTree();
		expect(screen.getByText(/Loading files/i)).toBeInTheDocument();
	});

	it("renders the root row with the worktree label when empty", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries([]));
		renderTree({ worktreeLabel: "my-repo" });
		expect(await screen.findByText("my-repo")).toBeInTheDocument();
		expect(
			await screen.findByText(/No files in this worktree/i),
		).toBeInTheDocument();
	});

	it("renders an error message when listWorktree rejects", async () => {
		mockListWorktree.mockRejectedValueOnce(new Error("boom"));
		renderTree({ worktreeLabel: "repo" });
		expect(
			await screen.findByText(/Unable to load files/i),
		).toBeInTheDocument();
		expect(await screen.findByText(/boom/)).toBeInTheDocument();
		// Root row + Refresh must still be accessible for retry
		expect(screen.getByText("repo")).toBeInTheDocument();
		fireEvent.contextMenu(screen.getByText("repo"));
		expect(
			await screen.findByRole("menuitem", { name: "Refresh" }),
		).toBeInTheDocument();
	});

	it("renders the root row + top-level entries on successful load", async () => {
		mockListWorktree.mockResolvedValueOnce(
			wrapEntries(["README.md", "src/a.ts"]),
		);
		const onExpandedPathsChange = vi.fn();
		renderTree({
			worktreeLabel: "repo",
			expandedPaths: [],
			onExpandedPathsChange,
		});
		expect(await screen.findByText("repo")).toBeInTheDocument();
		expect(onExpandedPathsChange).toHaveBeenCalledWith("wt-1", [""]);
	});
});

describe("WorktreeTree expand/collapse + selection", () => {
	it("clicking a folder dispatches onExpandedPathsChange", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["src/a.ts"]));
		const onExpandedPathsChange = vi.fn();
		renderTree({ expandedPaths: [""], onExpandedPathsChange });
		const srcRow = await screen.findByText("src");
		fireEvent.click(srcRow);
		expect(onExpandedPathsChange).toHaveBeenLastCalledWith("wt-1", ["", "src"]);
	});

	it("clicking an already-expanded folder collapses it", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["src/a.ts"]));
		const onExpandedPathsChange = vi.fn();
		renderTree({ expandedPaths: ["", "src"], onExpandedPathsChange });
		const srcRow = await screen.findByText("src");
		fireEvent.click(srcRow);
		expect(onExpandedPathsChange).toHaveBeenLastCalledWith("wt-1", [""]);
	});

	it("clicking a file calls onSelect and not onExpandedPathsChange for additional paths", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["src/a.ts"]));
		const onSelect = vi.fn();
		const onExpandedPathsChange = vi.fn();
		renderTree({ expandedPaths: ["", "src"], onSelect, onExpandedPathsChange });
		const fileRow = await screen.findByText("a.ts");
		fireEvent.click(fileRow);
		expect(onSelect).toHaveBeenCalledWith("src/a.ts");
		expect(
			onExpandedPathsChange.mock.calls.filter(([, paths]) => paths.length > 1),
		).toEqual([]);
	});
});

describe("WorktreeTree search", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("filters rows after the debounce elapses", async () => {
		mockListWorktree.mockResolvedValueOnce(
			wrapEntries(["src/App.tsx", "src/other.ts", "README.md"]),
		);
		renderTree({ expandedPaths: [""] });
		// Wait for the async load to complete before switching to fake timers
		await screen.findByText("README.md");
		vi.useFakeTimers();
		const input = screen.getByLabelText("Search files");
		fireEvent.change(input, { target: { value: "app" } });
		expect(screen.queryByText("README.md")).toBeInTheDocument();
		await act(async () => {
			vi.advanceTimersByTime(130);
		});
		expect(screen.queryByText("README.md")).not.toBeInTheDocument();
		expect(screen.getByText("App.tsx")).toBeInTheDocument();
	});

	it("does not dispatch onExpandedPathsChange when searching", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["src/deep/App.tsx"]));
		const onExpandedPathsChange = vi.fn();
		renderTree({ expandedPaths: [""], onExpandedPathsChange });
		// Wait for the async load to complete before switching to fake timers
		const input = await screen.findByLabelText("Search files");
		vi.useFakeTimers();
		fireEvent.change(input, { target: { value: "App" } });
		await act(async () => {
			vi.advanceTimersByTime(130);
		});
		expect(
			onExpandedPathsChange.mock.calls.filter(([, paths]) =>
				paths.includes("src"),
			),
		).toEqual([]);
	});
});

describe("WorktreeTree git status indicators", () => {
	it("renders the status letter next to a changed file", async () => {
		mockListWorktree.mockResolvedValueOnce(
			wrapEntries(["src/a.ts", "src/b.ts"]),
		);
		renderTree({
			expandedPaths: ["", "src"],
			changedFiles: [{ path: "src/a.ts", status: "M" }],
		});
		const row = await screen.findByText("a.ts");
		const badge = row.parentElement?.querySelector("[data-git-status]");
		expect(badge?.getAttribute("data-git-status")).toBe("M");
	});

	it("suppresses badges when gitSummaryError is true", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["src/a.ts"]));
		renderTree({
			expandedPaths: ["", "src"],
			changedFiles: [{ path: "src/a.ts", status: "M" }],
			gitSummaryError: true,
			gitSummaryMessage: "fake message",
		});
		await screen.findByText("a.ts");
		expect(document.querySelector("[data-git-status]")).toBeNull();
		expect(screen.getByText("fake message")).toBeInTheDocument();
	});

	it("still renders the tree when gitSummaryError is true (no hard-block)", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["src/a.ts"]));
		renderTree({ expandedPaths: ["", "src"], gitSummaryError: true });
		expect(await screen.findByText("a.ts")).toBeInTheDocument();
		expect(screen.queryByText(/Unable to load Git data/i)).toBeNull();
	});
});

describe("WorktreeTree root refresh", () => {
	it("re-fetches files when Refresh is picked from the root context menu", async () => {
		mockListWorktree.mockResolvedValue(wrapEntries(["src/a.ts"]));
		renderTree({ worktreeLabel: "repo", expandedPaths: [""] });
		await screen.findByText("repo");
		expect(mockListWorktree).toHaveBeenCalledTimes(1);
		const rootRow = screen.getByText("repo");
		fireEvent.contextMenu(rootRow);
		const refreshItem = await screen.findByRole("menuitem", {
			name: "Refresh",
		});
		fireEvent.click(refreshItem);
		expect(mockListWorktree).toHaveBeenCalledTimes(2);
	});
});

describe("WorktreeTree markdown preview", () => {
	it("calls onPreviewMarkdown when Preview is picked on a .md file", async () => {
		mockListWorktree.mockResolvedValueOnce(
			wrapEntries(["README.md", "src/a.ts"]),
		);
		const onPreviewMarkdown = vi.fn();
		renderTree({ expandedPaths: [""], onPreviewMarkdown });
		const mdRow = await screen.findByText("README.md");
		fireEvent.contextMenu(mdRow);
		const preview = await screen.findByRole("menuitem", { name: "Preview" });
		fireEvent.click(preview);
		expect(onPreviewMarkdown).toHaveBeenCalledWith("README.md");
	});

	it("does not show a preview menu on non-.md files", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["src/a.ts"]));
		renderTree({ expandedPaths: ["", "src"] });
		const tsRow = await screen.findByText("a.ts");
		fireEvent.contextMenu(tsRow);
		expect(screen.queryByRole("menuitem", { name: "Preview" })).toBeNull();
	});
});

describe("WorktreeTree file context menu — Edit removed (always-inline)", () => {
	it("never renders an Edit menu item on whitelisted files (modal flow gone)", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["package.json"]));
		const onPreviewMarkdown = vi.fn();
		renderTree({ expandedPaths: [""], onPreviewMarkdown });
		const row = await screen.findByText("package.json");
		fireEvent.contextMenu(row);
		expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
	});

	it("still shows Preview on a .md row when onPreviewMarkdown is provided", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["README.md"]));
		const onPreviewMarkdown = vi.fn();
		renderTree({ expandedPaths: [""], onPreviewMarkdown });
		const mdRow = await screen.findByText("README.md");
		fireEvent.contextMenu(mdRow);
		expect(
			await screen.findByRole("menuitem", { name: "Preview" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
	});

	it("shows no context menu on a non-markdown, non-whitelisted file", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["image.png"]));
		renderTree({ expandedPaths: [""] });
		const row = await screen.findByText("image.png");
		fireEvent.contextMenu(row);
		expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Preview" })).toBeNull();
	});
});

describe("WorktreeTree stale-request guard", () => {
	it("ignores a superseded response (later refresh wins)", async () => {
		type Entry = Awaited<ReturnType<typeof files.listWorktree>>[number];
		let resolveFirst: (v: Entry[]) => void = () => {};
		const firstPromise = new Promise<Entry[]>((resolve) => {
			resolveFirst = resolve;
		});
		mockListWorktree.mockReturnValueOnce(firstPromise);
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["from-second.ts"]));
		renderTree({ worktreeLabel: "repo", expandedPaths: [""] });
		const rootRow = await screen.findByText("repo");
		fireEvent.contextMenu(rootRow);
		const refresh = await screen.findByRole("menuitem", { name: "Refresh" });
		fireEvent.click(refresh);
		resolveFirst(wrapEntries(["from-first.ts"]));
		expect(await screen.findByText("from-second.ts")).toBeInTheDocument();
		expect(screen.queryByText("from-first.ts")).toBeNull();
	});

	it("ignores in-flight responses after a worktree switch", async () => {
		type Entry = Awaited<ReturnType<typeof files.listWorktree>>[number];
		let resolveA: (v: Entry[]) => void = () => {};
		const pendingA = new Promise<Entry[]>((resolve) => {
			resolveA = resolve;
		});
		mockListWorktree.mockImplementationOnce(() => pendingA);
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["wt-b-file.ts"]));
		const { rerender } = render(
			<WorktreeTree
				workspaceId="ws-1"
				worktreeId="wt-a"
				worktreeLabel="A"
				selectedFile={null}
				onSelect={vi.fn()}
				changedFiles={[]}
				expandedPaths={[""]}
				onExpandedPathsChange={vi.fn()}
				showIgnored={false}
				onToggleShowIgnored={vi.fn()}
			/>,
		);
		rerender(
			<WorktreeTree
				workspaceId="ws-1"
				worktreeId="wt-b"
				worktreeLabel="B"
				selectedFile={null}
				onSelect={vi.fn()}
				changedFiles={[]}
				expandedPaths={[""]}
				onExpandedPathsChange={vi.fn()}
				showIgnored={false}
				onToggleShowIgnored={vi.fn()}
			/>,
		);
		resolveA(wrapEntries(["wt-a-file.ts"]));
		expect(await screen.findByText("wt-b-file.ts")).toBeInTheDocument();
		expect(screen.queryByText("wt-a-file.ts")).toBeNull();
	});
});

describe("WorktreeTree show-ignored toggle", () => {
	it("renders ignored rows with data-ignored='true' when entries carry ignored:true", async () => {
		mockListWorktree.mockResolvedValueOnce([
			{ path: "a.ts", ignored: false },
			{ path: ".env", ignored: true },
		]);
		renderTree({ expandedPaths: [""], showIgnored: true });
		const envRow = await screen.findByText(".env");
		const envItem = envRow.closest(".shell-list__item");
		expect(envItem?.getAttribute("data-ignored")).toBe("true");
		const aRow = screen.getByText("a.ts");
		const aItem = aRow.closest(".shell-list__item");
		expect(aItem?.getAttribute("data-ignored")).toBeNull();
	});

	it("calls listWorktree with includeIgnored matching the prop", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["a.ts"]));
		renderTree({ expandedPaths: [""], showIgnored: false });
		await screen.findByText("a.ts");
		expect(mockListWorktree).toHaveBeenCalledWith("ws-1", "wt-1", {
			includeIgnored: false,
		});

		mockListWorktree.mockResolvedValueOnce(wrapEntries(["a.ts"]));
		const onToggle = vi.fn();
		// New render simulates parent flipping showIgnored=true after the toggle.
		renderTree({
			expandedPaths: [""],
			showIgnored: true,
			onToggleShowIgnored: onToggle,
		});
		await screen.findAllByText("a.ts");
		expect(mockListWorktree).toHaveBeenLastCalledWith("ws-1", "wt-1", {
			includeIgnored: true,
		});
	});

	it("dispatches onToggleShowIgnored when the toggle switch is clicked", async () => {
		mockListWorktree.mockResolvedValueOnce(wrapEntries(["a.ts"]));
		const onToggle = vi.fn();
		renderTree({ expandedPaths: [""], onToggleShowIgnored: onToggle });
		await screen.findByText("a.ts");
		const toggle = screen.getByRole("switch", {
			name: "Show gitignored files",
		});
		fireEvent.click(toggle);
		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});
