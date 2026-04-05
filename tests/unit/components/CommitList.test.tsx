import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitList } from "../../../src/features/git/CommitList";

describe("CommitList", () => {
	it("renders commits before files and notifies on commit selection", async () => {
		const onSelectCommit = vi.fn();

		render(
			<CommitList
				history={{
					mergeTargetRef: "origin/main",
					entries: [
						{ sha: "abc", shortSha: "abc", subject: "feature commit", isMergeTarget: false },
						{ sha: "base", shortSha: "base", subject: "origin/main", isMergeTarget: true },
					],
				}}
				selectedCommitSha={null}
				selectedCommitFilePath={null}
				activeDetail={null}
				onSelectCommit={onSelectCommit}
				onSelectCommitFile={vi.fn()}
			/>,
		);

		// Target ref shown as header and merge-target row rendered with its subject
		expect(screen.getAllByText("origin/main").length).toBeGreaterThanOrEqual(2);
		// Subject is visible text, not just aria-label
		expect(screen.getByText("feature commit")).toBeInTheDocument();
		// Merge-target row shows its shortSha
		expect(screen.getByText("base")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: /feature commit/i }));
		expect(onSelectCommit).toHaveBeenCalledWith("abc");
	});

	it("shows an empty state when no merge target ref exists", () => {
		render(
			<CommitList
				history={{ mergeTargetRef: null, entries: [] }}
				selectedCommitSha={null}
				selectedCommitFilePath={null}
				activeDetail={null}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
			/>,
		);
		expect(screen.getByText(/no recent commits/i)).toBeInTheDocument();
	});
});
