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
	git: {
		readCommitFileDiff: vi.fn(),
	},
}));

import { CommitList } from "../../../src/features/git/components/CommitList";
import { files, git } from "../../../src/lib/desktop-client";

const mockRead = vi.mocked(files.read);
const mockReadCommitFileDiff = vi.mocked(git.readCommitFileDiff);

describe("CommitList", () => {
	it("renders commits before files and notifies on commit selection", async () => {
		const onSelectCommit = vi.fn();

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
				workspaceId="workspace:test"
				worktreeId="wt-test"
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
				workspaceId="workspace:test"
				worktreeId="wt-test"
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
		mockReadCommitFileDiff.mockResolvedValue({
			path: "docs/notes.md",
			oldPath: null,
			status: "M",
			originalContent: "# Before\n",
			modifiedContent: "# Commit Preview\n",
		});
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
						{
							path: "docs/notes.md",
							oldPath: null,
							status: "M",
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
						{
							path: "docs/notes.md",
							oldPath: null,
							status: "D",
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
				screen.getByRole("button", { name: "Force push" }),
			).toBeInTheDocument();
		});
	});

	it("does not render push strip when remoteStatus is not provided", () => {
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

	it("shows an interactive Viewed toggle on the open commit-file row", () => {
		const onToggleViewed = vi.fn();
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
				selectedCommitFilePath="src/index.ts"
				activeDetail={{
					sha: "abc",
					shortSha: "abc",
					subject: "feature commit",
					files: [
						{ path: "src/index.ts", oldPath: null, status: "M" },
						{ path: "src/other.ts", oldPath: null, status: "M" },
					],
				}}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
				onToggleViewed={onToggleViewed}
				reviewedPaths={[]}
			/>,
		);
		const toggles = screen.getAllByTestId("mark-viewed-toggle");
		expect(toggles).toHaveLength(1);
		fireEvent.click(toggles[0]);
		expect(onToggleViewed).toHaveBeenCalledWith("src/index.ts");
	});

	it("keeps the commit-file toggle a sibling of the file-select button (no nested buttons)", () => {
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
				selectedCommitFilePath="src/index.ts"
				activeDetail={{
					sha: "abc",
					shortSha: "abc",
					subject: "feature commit",
					files: [{ path: "src/index.ts", oldPath: null, status: "M" }],
				}}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
				onToggleViewed={vi.fn()}
				reviewedPaths={[]}
			/>,
		);
		const toggle = screen.getByTestId("mark-viewed-toggle");
		const fileButton = screen.getByRole("button", { name: /src\/index\.ts/i });
		// The toggle must NOT be nested inside the file-select button (invalid DOM).
		expect(fileButton).not.toContainElement(toggle);
		// Both controls are siblings within the same row container.
		const row = toggle.closest(".shell-list__item-row");
		expect(row).not.toBeNull();
		expect(fileButton.closest(".shell-list__item-row")).toBe(row);
	});

	it("keeps non-open commit-file rows read-only", () => {
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
				selectedCommitFilePath="src/index.ts"
				activeDetail={{
					sha: "abc",
					shortSha: "abc",
					subject: "feature commit",
					files: [
						{ path: "src/index.ts", oldPath: null, status: "M" },
						{ path: "src/done.ts", oldPath: null, status: "M" },
					],
				}}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={vi.fn()}
				onToggleViewed={vi.fn()}
				reviewedPaths={["src/done.ts"]}
			/>,
		);
		// Non-open reviewed row keeps the read-only mark; only the open row toggles.
		expect(screen.getByTestId("reviewed-mark-src/done.ts")).toBeInTheDocument();
		expect(screen.getAllByTestId("mark-viewed-toggle")).toHaveLength(1);
	});

	it("makes the toggle live after a non-open commit file is selected", () => {
		const onSelectCommitFile = vi.fn();
		const onToggleViewed = vi.fn();
		const { rerender } = render(
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
						{ path: "src/index.ts", oldPath: null, status: "M" },
						{ path: "src/other.ts", oldPath: null, status: "M" },
					],
				}}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={onSelectCommitFile}
				onToggleViewed={onToggleViewed}
				reviewedPaths={[]}
			/>,
		);
		// No open file row → no interactive toggle.
		expect(screen.queryAllByTestId("mark-viewed-toggle")).toHaveLength(0);
		// Clicking a non-open file selects it.
		fireEvent.click(screen.getByRole("button", { name: /src\/other\.ts/i }));
		expect(onSelectCommitFile).toHaveBeenCalledWith("src/other.ts");
		// The parent promotes it to the open file → its toggle is live.
		rerender(
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
				selectedCommitFilePath="src/other.ts"
				activeDetail={{
					sha: "abc",
					shortSha: "abc",
					subject: "feature commit",
					files: [
						{ path: "src/index.ts", oldPath: null, status: "M" },
						{ path: "src/other.ts", oldPath: null, status: "M" },
					],
				}}
				onSelectCommit={vi.fn()}
				onSelectCommitFile={onSelectCommitFile}
				onToggleViewed={onToggleViewed}
				reviewedPaths={[]}
			/>,
		);
		const liveToggles = screen.getAllByTestId("mark-viewed-toggle");
		expect(liveToggles).toHaveLength(1);
		// Clicking the newly-live toggle toggles the newly-selected commit file.
		fireEvent.click(liveToggles[0]);
		expect(onToggleViewed).toHaveBeenCalledWith("src/other.ts");
	});
});
