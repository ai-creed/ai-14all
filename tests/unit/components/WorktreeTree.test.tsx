import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		listTracked: vi.fn(),
	},
}));

import { WorktreeTree } from "../../../src/features/viewer/WorktreeTree";
import { files } from "../../../src/lib/desktop-client";

const mockListTracked = vi.mocked(files.listTracked);

function renderTree(overrides: Partial<React.ComponentProps<typeof WorktreeTree>> = {}) {
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
		expect(await screen.findByText(/No files in this worktree/i)).toBeInTheDocument();
	});

	it("renders an error message when listTracked rejects", async () => {
		mockListTracked.mockRejectedValueOnce(new Error("boom"));
		renderTree();
		expect(await screen.findByText(/Unable to load files/i)).toBeInTheDocument();
		expect(await screen.findByText(/boom/)).toBeInTheDocument();
	});

	it("renders the root row + top-level entries on successful load", async () => {
		mockListTracked.mockResolvedValueOnce(["README.md", "src/a.ts"]);
		const onExpandedPathsChange = vi.fn();
		renderTree({ worktreeLabel: "repo", expandedPaths: [], onExpandedPathsChange });
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
		expect(onExpandedPathsChange.mock.calls.filter(([, paths]) => paths.length > 1)).toEqual([]);
	});

	it("clicking the root row is a no-op (expand/collapse via context menu only)", async () => {
		mockListTracked.mockResolvedValueOnce(["src/a.ts"]);
		const onExpandedPathsChange = vi.fn();
		renderTree({ worktreeLabel: "repo", expandedPaths: [""], onExpandedPathsChange });
		const rootRow = await screen.findByText("repo");
		fireEvent.click(rootRow);
		expect(onExpandedPathsChange.mock.calls.filter(([, paths]) => JSON.stringify(paths) !== JSON.stringify([""]))).toEqual([]);
	});
});
