import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Tabs } from "@/components/ui/tabs";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: { read: vi.fn() },
	git: { discardChange: vi.fn(), readCommitFileDiff: vi.fn() },
}));

import { ReviewRail } from "../../../src/features/review/components/ReviewRail";
import type { Worktree } from "../../../shared/models/worktree";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import type { ReviewLoadState } from "../../../src/app/hooks/review-load-state";
import type {
	GitCommitHistory,
	GitCommitDetail,
} from "../../../shared/models/git-commit-review";

const worktree = {
	id: "wt-1",
	label: "wt",
	path: "/tmp/wt",
} as unknown as Worktree;

const session = {
	reviewMode: "changes",
	selectedChangedFilePath: "src/a.ts",
	selectedCommitSha: null,
	selectedCommitFilePath: null,
} as unknown as WorktreeSession;

const historyState = {
	data: null,
	message: null,
	stale: false,
} as unknown as ReviewLoadState<GitCommitHistory>;
const detailState = {
	data: null,
	message: null,
	stale: false,
} as unknown as ReviewLoadState<GitCommitDetail>;

function renderRail() {
	return render(
		<Tabs value="changes">
			<ReviewRail
				activeWorktree={worktree}
				activeSession={session}
				activeWorkspaceId="ws-1"
				changes={[{ path: "src/a.ts", status: "M" }]}
				openCommentCounts={{}}
				reviewedPaths={[]}
				commitReviewedPaths={[]}
				commitOpenCommentCounts={{}}
				commitHistoryState={historyState}
				commitDetailState={detailState}
				remoteStatus={null}
				selectedCommitOpenCommentCount={0}
				gitSummaryError={false}
				gitSummaryStale={false}
				gitSummaryMessage={null}
				dispatch={() => {}}
				handleSelectChangedFile={() => {}}
				setDiscardPath={() => {}}
				handlePushBranch={async () => {}}
				requestFileSwitch={async () => "proceed" as const}
				onCloseReview={() => {}}
				installCtaVisible={false}
				onOpenInstall={() => {}}
				header={<div data-testid="rail-header-slot" />}
			/>
		</Tabs>,
	);
}

describe("ReviewRail grid structure (file open, Changes mode)", () => {
	it("renders toolbar and scroll as distinct direct grid children, toolbar first", () => {
		const { container } = renderRail();
		const rail = container.querySelector(".shell-review-rail");
		expect(rail).not.toBeNull();
		const children = Array.from((rail as HTMLElement).children);
		const toolbars = children.filter((el) =>
			el.classList.contains("shell-review-rail__toolbar"),
		);
		const scrolls = children.filter((el) =>
			el.classList.contains("shell-review-rail__scroll"),
		);
		// Exactly one of each, both DIRECT children of the rail grid.
		expect(toolbars).toHaveLength(1);
		expect(scrolls).toHaveLength(1);
		// The header slot lives inside the toolbar wrapper, not as a loose grid item.
		expect(
			toolbars[0].querySelector('[data-testid="rail-header-slot"]'),
		).not.toBeNull();
		// Order: the toolbar row precedes the scroll list.
		expect(children.indexOf(toolbars[0])).toBeLessThan(
			children.indexOf(scrolls[0]),
		);
	});
});
