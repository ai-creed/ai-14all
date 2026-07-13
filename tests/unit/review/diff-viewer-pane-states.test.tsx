import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { RefObject } from "react";
import { DiffViewerPane } from "../../../src/features/review/components/DiffViewerPane";
import { ToastProvider } from "../../../src/features/ui/toast/ToastProvider";
import { createDiffEditorRegistry } from "../../../src/features/review/logic/diff-editor-registry";
import type { ReviewComment } from "../../../shared/models/review-comment";
import type { Worktree } from "../../../shared/models/worktree";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import type { GitDiff } from "../../../shared/models/git-diff";
import type { ReviewLoadState } from "../../../src/app/hooks/review-load-state";
import type { InlineEditorHandle } from "../../../src/features/viewer/components/InlineEditor";

// Task 14 only concerns the changes-mode render ladder's data/loading/error
// branches in DiffViewerPane, so the inline-comment bridge and the real
// Monaco-backed DiffViewer are stubbed out, mirroring the conventions in
// diff-viewer-pane-undo.test.tsx and diff-viewer-pane-focus.test.tsx.
vi.mock("../../../src/features/review/components/InlineMountsBridge", () => ({
	InlineMountsBridge: () => <div data-testid="bridge-stub" />,
}));

vi.mock("../../../src/features/viewer/components/DiffViewer", () => ({
	DiffViewer: (props: { path: string }) => (
		<div data-testid="diff-viewer-stub">{props.path}</div>
	),
}));

const FILE_PATH = "a.ts";

const worktree: Worktree = {
	id: "w1",
	repositoryId: "r1",
	branchName: "main",
	path: "/tmp/w1",
	label: "w1",
	isMain: true,
};

const changesSessionSelected = {
	reviewMode: "changes",
	selectedChangedFilePath: FILE_PATH,
	selectedCommitSha: null,
	selectedCommitFilePath: null,
} as unknown as WorktreeSession;

const changesSessionUnselected = {
	reviewMode: "changes",
	selectedChangedFilePath: null,
	selectedCommitSha: null,
	selectedCommitFilePath: null,
} as unknown as WorktreeSession;

const diffData: GitDiff = {
	path: FILE_PATH,
	content: "",
	originalContent: "",
	modifiedContent: "",
};

function buildReviewState() {
	return {
		comments: [] as ReviewComment[],
		loading: false,
		error: null,
		refresh: vi.fn(),
		create: vi.fn(),
		markAddressed: vi.fn(),
		reopen: vi.fn(),
		remove: vi.fn(),
		restore: vi.fn(),
		update: vi.fn(),
		clearAddressed: vi.fn(),
	};
}

function renderPane(
	activeSession: WorktreeSession | null,
	diffState: ReviewLoadState<GitDiff>,
) {
	return render(
		<ToastProvider>
			<DiffViewerPane
				activeWorktree={worktree}
				activeSession={activeSession}
				activeWorkspaceId={null}
				diffState={diffState}
				commitDetailState={{ data: null, stale: false, message: null }}
				reviewState={buildReviewState()}
				registry={createDiffEditorRegistry()}
				resolvedTheme="light"
				hideAddressed={false}
				currentFilePath={activeSession?.selectedChangedFilePath ?? null}
				addingDraft={null}
				setAddingDraft={vi.fn()}
				updateAddingDraftBody={vi.fn()}
				bumpRefreshKey={vi.fn()}
				dispatch={vi.fn()}
				inlineEditorRef={
					{ current: null } as RefObject<InlineEditorHandle | null>
				}
				focusedThreadId={null}
				onFocusedThreadChange={vi.fn()}
			/>
		</ToastProvider>,
	);
}

describe("DiffViewerPane changes-mode load states", () => {
	it("renders the diff-load error message in .shell-error when a changed file is selected and loading failed", () => {
		const { container } = renderPane(changesSessionSelected, {
			data: null,
			message: "boom",
			stale: false,
		});

		const error = container.querySelector(".shell-error");
		expect(error).not.toBeNull();
		expect(error?.textContent).toBe("boom");
		expect(container.querySelector(".shell-empty-state")).toBeNull();
	});

	it("renders a loading placeholder in .shell-empty-state when a changed file is selected and the diff hasn't arrived yet", () => {
		const { container } = renderPane(changesSessionSelected, {
			data: null,
			message: null,
			stale: false,
		});

		const empty = container.querySelector(".shell-empty-state");
		expect(empty).not.toBeNull();
		expect(empty?.textContent).toBe("Loading diff…");
	});

	it("renders the generic empty state when nothing is selected", () => {
		const { container } = renderPane(null, {
			data: null,
			message: null,
			stale: false,
		});

		const empty = container.querySelector(".shell-empty-state");
		expect(empty).not.toBeNull();
		expect(empty?.textContent).toBe(
			"Select a file or changed file to inspect it.",
		);
	});

	it("renders the generic empty state in changes mode when no changed file is selected, even while message is set", () => {
		const { container } = renderPane(changesSessionUnselected, {
			data: null,
			message: "boom",
			stale: false,
		});

		const empty = container.querySelector(".shell-empty-state");
		expect(empty).not.toBeNull();
		expect(empty?.textContent).toBe(
			"Select a file or changed file to inspect it.",
		);
		expect(container.querySelector(".shell-error")).toBeNull();
	});

	it("still renders DiffViewer when diff data is present", () => {
		const { container, getByTestId } = renderPane(changesSessionSelected, {
			data: diffData,
			message: null,
			stale: false,
		});

		expect(getByTestId("diff-viewer-stub")).toBeInTheDocument();
		expect(container.querySelector(".shell-error")).toBeNull();
		expect(container.querySelector(".shell-empty-state")).toBeNull();
	});

	it("keeps rendering DiffViewer from stale data even when a message is also set", () => {
		const { container, getByTestId } = renderPane(changesSessionSelected, {
			data: diffData,
			message: "stale warning",
			stale: true,
		});

		expect(getByTestId("diff-viewer-stub")).toBeInTheDocument();
		expect(container.querySelector(".shell-error")).toBeNull();
	});
});
