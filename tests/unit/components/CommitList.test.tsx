import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
				selectedCommitSha="abc"
				selectedCommitFilePath="src/index.ts"
				activeDetail={{
					sha: "abc",
					shortSha: "abc",
					subject: "feature commit",
					files: [
						{
							path: "src/index.ts",
							oldPath: null,
							status: "M",
							originalContent: "before\n",
							modifiedContent: "after\n",
						},
					],
				}}
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
		const selectedRow = screen
			.getByRole("button", { name: /feature commit/i })
			.closest(".shell-commit-list__row");
		expect(selectedRow).not.toBeNull();
		expect(
			within(selectedRow as HTMLElement).getByRole("button", {
				name: /src\/index\.ts/i,
			}),
		).toBeInTheDocument();
		// Click the non-selected merge-target row to verify selection is notified.
		await userEvent.click(screen.getByRole("button", { name: /origin\/main/i }));
		expect(onSelectCommit).toHaveBeenCalledWith("base");
	});

	it("deselects the commit when clicking the already-selected row", async () => {
		const onSelectCommit = vi.fn();
		const onDeselectCommit = vi.fn();

		render(
			<CommitList
				history={{
					mergeTargetRef: "origin/main",
					entries: [
						{ sha: "abc", shortSha: "abc", subject: "feature commit", isMergeTarget: false },
						{ sha: "base", shortSha: "base", subject: "initial commit", isMergeTarget: true },
					],
				}}
				selectedCommitSha="abc"
				selectedCommitFilePath={null}
				activeDetail={null}
				onSelectCommit={onSelectCommit}
				onDeselectCommit={onDeselectCommit}
				onSelectCommitFile={vi.fn()}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /feature commit/i }));
		expect(onDeselectCommit).toHaveBeenCalledTimes(1);
		expect(onSelectCommit).not.toHaveBeenCalled();
	});

	it("shows changed files for a selected merge-target commit", () => {
		render(
			<CommitList
				history={{
					mergeTargetRef: "origin/main",
					entries: [
						{ sha: "base", shortSha: "base", subject: "origin/main", isMergeTarget: true },
					],
				}}
				selectedCommitSha="base"
				selectedCommitFilePath={null}
				activeDetail={{
					sha: "base",
					shortSha: "base",
					subject: "origin/main",
					files: [
						{
							path: "src/index.ts",
							oldPath: null,
							status: "M",
							originalContent: "before\n",
							modifiedContent: "after\n",
						},
					],
				}}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
			/>,
		);

		const selectedRow = screen
			.getByRole("button", { name: /origin\/main/i })
			.closest(".shell-commit-list__row");
		expect(selectedRow).not.toBeNull();
		expect(
			within(selectedRow as HTMLElement).getByRole("button", {
				name: /src\/index\.ts/i,
			}),
		).toBeInTheDocument();
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
