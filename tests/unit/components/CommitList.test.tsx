import { describe, it, expect, vi } from "vitest";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		read: vi.fn(),
	},
}));

import { CommitList } from "../../../src/features/git/CommitList";
import { files } from "../../../src/lib/desktop-client";

const mockRead = vi.mocked(files.read);

describe("CommitList", () => {
	it("renders commits before files and notifies on commit selection", async () => {
		const onSelectCommit = vi.fn();

		render(
			<CommitList
				worktreePath="/repo"
				history={{
					mergeTargetRef: "origin/main",
					entries: [
						{
							sha: "abc",
							shortSha: "abc",
							subject: "feature commit",
							isMergeTarget: false,
						},
						{
							sha: "base",
							shortSha: "base",
							subject: "origin/main",
							isMergeTarget: true,
						},
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
		await userEvent.click(
			screen.getByRole("button", { name: /origin\/main/i }),
		);
		expect(onSelectCommit).toHaveBeenCalledWith("base");
	});

	it("deselects the commit when clicking the already-selected row", async () => {
		const onSelectCommit = vi.fn();
		const onDeselectCommit = vi.fn();

		render(
			<CommitList
				worktreePath="/repo"
				history={{
					mergeTargetRef: "origin/main",
					entries: [
						{
							sha: "abc",
							shortSha: "abc",
							subject: "feature commit",
							isMergeTarget: false,
						},
						{
							sha: "base",
							shortSha: "base",
							subject: "initial commit",
							isMergeTarget: true,
						},
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

		await userEvent.click(
			screen.getByRole("button", { name: /feature commit/i }),
		);
		expect(onDeselectCommit).toHaveBeenCalledTimes(1);
		expect(onSelectCommit).not.toHaveBeenCalled();
	});

	it("shows changed files for a selected merge-target commit", () => {
		render(
			<CommitList
				worktreePath="/repo"
				history={{
					mergeTargetRef: "origin/main",
					entries: [
						{
							sha: "base",
							shortSha: "base",
							subject: "origin/main",
							isMergeTarget: true,
						},
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
				worktreePath="/repo"
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

	it("shows Preview for markdown commit files and uses snapshot content", async () => {
		render(
			<CommitList
				worktreePath="/repo"
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
						{
							path: "docs/notes.md",
							oldPath: null,
							status: "M",
							originalContent: "# Before\n",
							modifiedContent: "# Commit Preview\n",
						},
					],
				}}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
			/>,
		);

		fireEvent.contextMenu(
			screen.getByRole("button", { name: /docs\/notes\.md/i }),
		);
		await userEvent.click(
			await screen.findByRole("menuitem", { name: "Preview" }),
		);

		expect(
			await screen.findByRole("heading", { name: "Commit Preview" }),
		).toBeInTheDocument();
		expect(mockRead).not.toHaveBeenCalled();
	});

	it("does not show Preview for deleted markdown commit files", () => {
		render(
			<CommitList
				worktreePath="/repo"
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
						{
							path: "docs/notes.md",
							oldPath: null,
							status: "D",
							originalContent: "# Removed\n",
							modifiedContent: "",
						},
					],
				}}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
			/>,
		);

		fireEvent.contextMenu(
			screen.getByRole("button", { name: /docs\/notes\.md/i }),
		);
		expect(
			screen.queryByRole("menuitem", { name: "Preview" }),
		).not.toBeInTheDocument();
	});

	it("renders the push strip when remoteStatus is provided", () => {
		render(
			<CommitList
				worktreePath="/repo"
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
				selectedCommitSha={null}
				selectedCommitFilePath={null}
				activeDetail={null}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
				remoteStatus={{ hasRemote: true, ahead: 2, behind: 0 }}
				onPush={vi.fn()}
			/>,
		);
		expect(screen.getByText(/↑2/)).toBeInTheDocument();
		expect(screen.getByText(/↓0/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Push" })).toBeInTheDocument();
	});

	it("disables push button when ahead is 0", () => {
		render(
			<CommitList
				worktreePath="/repo"
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
				selectedCommitSha={null}
				selectedCommitFilePath={null}
				activeDetail={null}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
				remoteStatus={{ hasRemote: true, ahead: 0, behind: 0 }}
				onPush={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();
	});

	it("disables push button when hasRemote is false", () => {
		render(
			<CommitList
				worktreePath="/repo"
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
				selectedCommitSha={null}
				selectedCommitFilePath={null}
				activeDetail={null}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
				remoteStatus={{ hasRemote: false, ahead: 0, behind: 0 }}
				onPush={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();
	});

	it("calls onPush(false) directly when behind is 0 and Push is clicked", async () => {
		const onPush = vi.fn().mockResolvedValue(undefined);
		render(
			<CommitList
				worktreePath="/repo"
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
				selectedCommitSha={null}
				selectedCommitFilePath={null}
				activeDetail={null}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
				remoteStatus={{ hasRemote: true, ahead: 1, behind: 0 }}
				onPush={onPush}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Push" }));
		await waitFor(() => {
			expect(onPush).toHaveBeenCalledWith(false);
		});
	});

	it("opens the force push dialog when behind > 0 and Push is clicked", async () => {
		render(
			<CommitList
				worktreePath="/repo"
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
				selectedCommitSha={null}
				selectedCommitFilePath={null}
				activeDetail={null}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
				remoteStatus={{ hasRemote: true, ahead: 1, behind: 2 }}
				onPush={vi.fn().mockResolvedValue(undefined)}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Push" }));
		await waitFor(() => {
			expect(screen.getByText(/2 commit/i)).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: "Force Push" }),
			).toBeInTheDocument();
		});
	});

	it("does not render push strip when remoteStatus is not provided", () => {
		render(
			<CommitList
				worktreePath="/repo"
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
				selectedCommitSha={null}
				selectedCommitFilePath={null}
				activeDetail={null}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: "Push" }),
		).not.toBeInTheDocument();
	});
});
