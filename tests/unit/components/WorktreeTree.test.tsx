import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
