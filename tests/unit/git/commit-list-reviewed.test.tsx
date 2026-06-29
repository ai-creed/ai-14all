import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: { read: vi.fn() },
	git: { readCommitFileDiff: vi.fn() },
}));

import { CommitList } from "../../../src/features/git/components/CommitList";

describe("CommitList reviewed marker", () => {
	it("renders a reviewed mark only on reviewed commit files", () => {
		render(
			<CommitList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				history={{
					mergeTargetRef: "origin/main",
					entries: [
						{
							sha: "abc",
							shortSha: "abc",
							subject: "feature commit",
							isMergeTarget: false,
						},
					],
				}}
				selectedCommitSha="abc"
				selectedCommitFilePath={null}
				activeDetail={{
					sha: "abc",
					shortSha: "abc",
					subject: "feature commit",
					files: [
						{ path: "src/a.ts", oldPath: null, status: "M" },
						{ path: "src/b.ts", oldPath: null, status: "M" },
					],
				}}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
				reviewedPaths={["src/a.ts"]}
				openCommentCounts={{ "src/b.ts": 2 }}
			/>,
		);
		expect(screen.getByTestId("reviewed-mark-src/a.ts")).toBeInTheDocument();
		expect(screen.queryByTestId("reviewed-mark-src/b.ts")).toBeNull();
		expect(screen.getByText("[2]")).toBeInTheDocument();
	});
});
