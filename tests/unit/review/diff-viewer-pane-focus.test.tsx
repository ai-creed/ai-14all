import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RefObject } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import { DiffViewerPane } from "../../../src/features/review/components/DiffViewerPane";
import { ToastProvider } from "../../../src/features/ui/toast/ToastProvider";
import { createDiffEditorRegistry } from "../../../src/features/review/logic/diff-editor-registry";
import type { ReviewComment } from "../../../shared/models/review-comment";
import type { Worktree } from "../../../shared/models/worktree";
import type { InlineEditorHandle } from "../../../src/features/viewer/components/InlineEditor";
import type { NewCommentDraft } from "../../../src/app/components/ReviewArea";

// Mirrors the InlineMountsBridge stub used by diff-viewer-pane-undo.test.tsx:
// the bridge normally mounts thread widgets into a live Monaco diff editor via
// portals, which this suite doesn't exercise. Instead it stubs the bridge
// down to plain buttons wired to the same callbacks DiffViewerPane passes in,
// so each thread-closing action (draft submit/cancel, edit save/cancel,
// delete) can be triggered directly and its focus-restore side effect
// observed on `document.activeElement`.
vi.mock("../../../src/features/review/components/InlineMountsBridge", () => ({
	InlineMountsBridge: (props: {
		onSave: (id: string, body: string) => Promise<boolean>;
		onDelete: (id: string) => void;
		onSubmitDraft: () => void;
		onCancelDraft: () => void;
		onCancelEdit: () => void;
	}) => (
		<div data-testid="bridge-stub">
			<button onClick={() => void props.onSave("c1", "updated body")}>
				save-c1
			</button>
			<button onClick={() => props.onDelete("c1")}>delete-c1</button>
			<button onClick={() => props.onSubmitDraft()}>submit-draft</button>
			<button onClick={() => props.onCancelDraft()}>cancel-draft</button>
			<button onClick={() => props.onCancelEdit()}>cancel-edit</button>
		</div>
	),
}));

const FILE_PATH = "a.ts";

function comment(over: Partial<ReviewComment> = {}): ReviewComment {
	return {
		id: "c1",
		worktreeId: "w1",
		filePath: FILE_PATH,
		startLine: 1,
		endLine: 1,
		snippet: "x",
		body: "body",
		status: "open",
		source: "working-tree",
		commitSha: null,
		createdAt: "2026-05-14T00:00:00.000Z",
		addressedAt: null,
		...over,
	};
}

const worktree: Worktree = {
	id: "w1",
	repositoryId: "r1",
	branchName: "main",
	path: "/tmp/w1",
	label: "w1",
	isMain: true,
};

function buildReviewState(comments: ReviewComment[]) {
	return {
		comments,
		loading: false,
		error: null,
		refresh: vi.fn(),
		create: vi.fn().mockResolvedValue(comment()),
		markAddressed: vi.fn(),
		reopen: vi.fn(),
		remove: vi.fn().mockResolvedValue(undefined),
		restore: vi.fn().mockResolvedValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		clearAddressed: vi.fn(),
	};
}

// Seeds the registry with a fake diff-editor entry whose modified-editor
// focus() moves document.activeElement to a sentinel node, standing in for
// the real Monaco `getModifiedEditor().focus()` call.
function seedRegistry(filePath: string) {
	const registry = createDiffEditorRegistry();
	const sentinel = document.createElement("button");
	sentinel.setAttribute("data-testid", "sentinel-editor-focus-target");
	document.body.appendChild(sentinel);
	const fakeEditor = {
		getModifiedEditor: () => ({
			focus: () => sentinel.focus(),
		}),
	} as unknown as MonacoEditor.IStandaloneDiffEditor;
	registry.register(filePath, fakeEditor);
	return { registry, sentinel };
}

function renderPane(
	reviewState: ReturnType<typeof buildReviewState>,
	registry: ReturnType<typeof createDiffEditorRegistry>,
	addingDraft: NewCommentDraft | null,
) {
	return render(
		<ToastProvider>
			<DiffViewerPane
				activeWorktree={worktree}
				activeSession={null}
				activeWorkspaceId={null}
				diffState={{ data: null, stale: false, message: null }}
				commitDetailState={{ data: null, stale: false, message: null }}
				reviewState={reviewState}
				registry={registry}
				resolvedTheme="light"
				hideAddressed={false}
				currentFilePath={FILE_PATH}
				addingDraft={addingDraft}
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

const draft: NewCommentDraft = {
	filePath: FILE_PATH,
	startLine: 1,
	endLine: 1,
	snippet: "x",
	body: "a new comment",
	source: "working-tree",
	commitSha: null,
};

describe("DiffViewerPane focus restore", () => {
	it("focuses the host editor after a draft submit resolves", async () => {
		const user = userEvent.setup();
		const { registry, sentinel } = seedRegistry(FILE_PATH);
		const reviewState = buildReviewState([]);
		renderPane(reviewState, registry, draft);

		await user.click(screen.getByRole("button", { name: "submit-draft" }));

		await waitFor(() => expect(document.activeElement).toBe(sentinel));
	});

	it("focuses the host editor after draft cancel", async () => {
		const user = userEvent.setup();
		const { registry, sentinel } = seedRegistry(FILE_PATH);
		const reviewState = buildReviewState([]);
		renderPane(reviewState, registry, draft);

		await user.click(screen.getByRole("button", { name: "cancel-draft" }));

		await waitFor(() => expect(document.activeElement).toBe(sentinel));
	});

	it("focuses the host editor after an edit save resolves", async () => {
		const user = userEvent.setup();
		const { registry, sentinel } = seedRegistry(FILE_PATH);
		const reviewState = buildReviewState([comment()]);
		renderPane(reviewState, registry, null);

		await user.click(screen.getByRole("button", { name: "save-c1" }));

		await waitFor(() => expect(document.activeElement).toBe(sentinel));
	});

	it("focuses the host editor after edit cancel", async () => {
		const user = userEvent.setup();
		const { registry, sentinel } = seedRegistry(FILE_PATH);
		const reviewState = buildReviewState([comment()]);
		renderPane(reviewState, registry, null);

		await user.click(screen.getByRole("button", { name: "cancel-edit" }));

		await waitFor(() => expect(document.activeElement).toBe(sentinel));
	});

	it("focuses the host editor after a delete resolves", async () => {
		const user = userEvent.setup();
		const { registry, sentinel } = seedRegistry(FILE_PATH);
		const reviewState = buildReviewState([comment()]);
		renderPane(reviewState, registry, null);

		await user.click(screen.getByRole("button", { name: "delete-c1" }));

		await waitFor(() => expect(document.activeElement).toBe(sentinel));
	});
});
