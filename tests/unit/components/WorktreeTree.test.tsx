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
		listTracked: vi.fn(),
	},
}));

import { WorktreeTree } from "../../../src/features/viewer/WorktreeTree";
import { files } from "../../../src/lib/desktop-client";

const mockListTracked = vi.mocked(files.listTracked);

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
			{...overrides}
		/>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("WorktreeTree basic states", () => {
	it("shows a loading message while files are being fetched", () => {
		mockListTracked.mockReturnValue(new Promise(() => {}));
		renderTree();
		expect(screen.getByText(/Loading files/i)).toBeInTheDocument();
	});

	it("renders the root row with the worktree label when empty", async () => {
		mockListTracked.mockResolvedValueOnce([]);
		renderTree({ worktreeLabel: "my-repo" });
		expect(await screen.findByText("my-repo")).toBeInTheDocument();
		expect(
			await screen.findByText(/No files in this worktree/i),
		).toBeInTheDocument();
	});

	it("renders an error message when listTracked rejects", async () => {
		mockListTracked.mockRejectedValueOnce(new Error("boom"));
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
		mockListTracked.mockResolvedValueOnce(["README.md", "src/a.ts"]);
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
		mockListTracked.mockResolvedValueOnce(["src/a.ts"]);
		const onExpandedPathsChange = vi.fn();
		renderTree({ expandedPaths: [""], onExpandedPathsChange });
		const srcRow = await screen.findByText("src");
		fireEvent.click(srcRow);
		expect(onExpandedPathsChange).toHaveBeenLastCalledWith("wt-1", ["", "src"]);
	});

	it("clicking an already-expanded folder collapses it", async () => {
		mockListTracked.mockResolvedValueOnce(["src/a.ts"]);
		const onExpandedPathsChange = vi.fn();
		renderTree({ expandedPaths: ["", "src"], onExpandedPathsChange });
		const srcRow = await screen.findByText("src");
		fireEvent.click(srcRow);
		expect(onExpandedPathsChange).toHaveBeenLastCalledWith("wt-1", [""]);
	});

	it("clicking a file calls onSelect and not onExpandedPathsChange for additional paths", async () => {
		mockListTracked.mockResolvedValueOnce(["src/a.ts"]);
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
		mockListTracked.mockResolvedValueOnce([
			"src/App.tsx",
			"src/other.ts",
			"README.md",
		]);
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
		mockListTracked.mockResolvedValueOnce(["src/deep/App.tsx"]);
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
		mockListTracked.mockResolvedValueOnce(["src/a.ts", "src/b.ts"]);
		renderTree({
			expandedPaths: ["", "src"],
			changedFiles: [{ path: "src/a.ts", status: "M" }],
		});
		const row = await screen.findByText("a.ts");
		const badge = row.parentElement?.querySelector("[data-git-status]");
		expect(badge?.getAttribute("data-git-status")).toBe("M");
	});

	it("suppresses badges when gitSummaryError is true", async () => {
		mockListTracked.mockResolvedValueOnce(["src/a.ts"]);
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
		mockListTracked.mockResolvedValueOnce(["src/a.ts"]);
		renderTree({ expandedPaths: ["", "src"], gitSummaryError: true });
		expect(await screen.findByText("a.ts")).toBeInTheDocument();
		expect(screen.queryByText(/Unable to load Git data/i)).toBeNull();
	});
});

describe("WorktreeTree root refresh", () => {
	it("re-fetches files when Refresh is picked from the root context menu", async () => {
		mockListTracked.mockResolvedValue(["src/a.ts"]);
		renderTree({ worktreeLabel: "repo", expandedPaths: [""] });
		await screen.findByText("repo");
		expect(mockListTracked).toHaveBeenCalledTimes(1);
		const rootRow = screen.getByText("repo");
		fireEvent.contextMenu(rootRow);
		const refreshItem = await screen.findByRole("menuitem", {
			name: "Refresh",
		});
		fireEvent.click(refreshItem);
		expect(mockListTracked).toHaveBeenCalledTimes(2);
	});
});

describe("WorktreeTree markdown preview", () => {
	it("calls onPreviewMarkdown when Preview is picked on a .md file", async () => {
		mockListTracked.mockResolvedValueOnce(["README.md", "src/a.ts"]);
		const onPreviewMarkdown = vi.fn();
		renderTree({ expandedPaths: [""], onPreviewMarkdown });
		const mdRow = await screen.findByText("README.md");
		fireEvent.contextMenu(mdRow);
		const preview = await screen.findByRole("menuitem", { name: "Preview" });
		fireEvent.click(preview);
		expect(onPreviewMarkdown).toHaveBeenCalledWith("README.md");
	});

	it("does not show a preview menu on non-.md files", async () => {
		mockListTracked.mockResolvedValueOnce(["src/a.ts"]);
		renderTree({ expandedPaths: ["", "src"] });
		const tsRow = await screen.findByText("a.ts");
		fireEvent.contextMenu(tsRow);
		expect(screen.queryByRole("menuitem", { name: "Preview" })).toBeNull();
	});
});

describe("WorktreeTree editor context menu", () => {
	it("shows both Preview and Edit on a .md row when onEditFile is provided", async () => {
		mockListTracked.mockResolvedValueOnce(["README.md"]);
		const onPreviewMarkdown = vi.fn();
		const onEditFile = vi.fn();
		renderTree({ expandedPaths: [""], onPreviewMarkdown, onEditFile });
		const mdRow = await screen.findByText("README.md");
		fireEvent.contextMenu(mdRow);
		expect(
			await screen.findByRole("menuitem", { name: "Preview" }),
		).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
	});

	it("shows only Edit (no Preview) on a non-markdown whitelisted file", async () => {
		mockListTracked.mockResolvedValueOnce(["package.json"]);
		const onEditFile = vi.fn();
		renderTree({ expandedPaths: [""], onEditFile });
		const row = await screen.findByText("package.json");
		fireEvent.contextMenu(row);
		expect(
			await screen.findByRole("menuitem", { name: "Edit" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("menuitem", { name: "Preview" })).toBeNull();
	});

	it("shows only Edit on a .md row when only onEditFile is provided (no preview handler)", async () => {
		mockListTracked.mockResolvedValueOnce(["README.md"]);
		const onEditFile = vi.fn();
		renderTree({ expandedPaths: [""], onEditFile });
		const mdRow = await screen.findByText("README.md");
		fireEvent.contextMenu(mdRow);
		expect(
			await screen.findByRole("menuitem", { name: "Edit" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("menuitem", { name: "Preview" })).toBeNull();
	});

	it("shows no context menu items on a non-whitelisted file", async () => {
		mockListTracked.mockResolvedValueOnce(["image.png"]);
		const onEditFile = vi.fn();
		renderTree({ expandedPaths: [""], onEditFile });
		const row = await screen.findByText("image.png");
		fireEvent.contextMenu(row);
		expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Preview" })).toBeNull();
	});
});

describe("WorktreeTree stale-request guard", () => {
	it("ignores a superseded response (later refresh wins)", async () => {
		let resolveFirst: (v: string[]) => void = () => {};
		const firstPromise = new Promise<string[]>((resolve) => {
			resolveFirst = resolve;
		});
		mockListTracked.mockReturnValueOnce(firstPromise);
		mockListTracked.mockResolvedValueOnce(["from-second.ts"]);
		renderTree({ worktreeLabel: "repo", expandedPaths: [""] });
		const rootRow = await screen.findByText("repo");
		fireEvent.contextMenu(rootRow);
		const refresh = await screen.findByRole("menuitem", { name: "Refresh" });
		fireEvent.click(refresh);
		resolveFirst(["from-first.ts"]);
		expect(await screen.findByText("from-second.ts")).toBeInTheDocument();
		expect(screen.queryByText("from-first.ts")).toBeNull();
	});

	it("ignores in-flight responses after a worktree switch", async () => {
		let resolveA: (v: string[]) => void = () => {};
		const pendingA = new Promise<string[]>((resolve) => {
			resolveA = resolve;
		});
		mockListTracked.mockImplementationOnce(() => pendingA);
		mockListTracked.mockResolvedValueOnce(["wt-b-file.ts"]);
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
			/>,
		);
		resolveA(["wt-a-file.ts"]);
		expect(await screen.findByText("wt-b-file.ts")).toBeInTheDocument();
		expect(screen.queryByText("wt-a-file.ts")).toBeNull();
	});
});
