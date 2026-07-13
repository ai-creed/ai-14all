import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RefObject } from "react";
import { DiffViewerPane } from "../../../src/features/review/components/DiffViewerPane";
import { ToastProvider } from "../../../src/features/ui/toast/ToastProvider";
import { createDiffEditorRegistry } from "../../../src/features/review/logic/diff-editor-registry";
import type { ReviewComment } from "../../../shared/models/review-comment";
import type { Worktree } from "../../../shared/models/worktree";
import type { InlineEditorHandle } from "../../../src/features/viewer/components/InlineEditor";

// InlineMountsBridge normally mounts comment widgets into a live Monaco diff
// editor via portals (exercised by use-inline-thread-mounts.test.tsx). Task 11
// only concerns DiffViewerPane's own onDelete orchestration (snapshot → remove
// → undo toast), so the bridge is replaced with a stub that exposes its
// `onDelete` prop as plain buttons, keyed by a fixed comment id.
vi.mock("../../../src/features/review/components/InlineMountsBridge", () => ({
	InlineMountsBridge: ({ onDelete }: { onDelete: (id: string) => void }) => (
		<div data-testid="bridge-stub">
			<button onClick={() => onDelete("c1")}>delete-c1</button>
			<button onClick={() => onDelete("c2")}>delete-c2</button>
		</div>
	),
}));

function comment(over: Partial<ReviewComment> = {}): ReviewComment {
	return {
		id: "c1",
		worktreeId: "w1",
		filePath: "a.ts",
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
		create: vi.fn(),
		markAddressed: vi.fn(),
		reopen: vi.fn(),
		remove: vi.fn().mockResolvedValue(undefined),
		restore: vi.fn().mockResolvedValue(undefined),
		update: vi.fn(),
		clearAddressed: vi.fn(),
	};
}

function renderPane(reviewState: ReturnType<typeof buildReviewState>) {
	return render(
		<ToastProvider>
			<DiffViewerPane
				activeWorktree={worktree}
				activeSession={null}
				activeWorkspaceId={null}
				diffState={{ data: null, stale: false, message: null }}
				commitDetailState={{ data: null, stale: false, message: null }}
				reviewState={reviewState}
				registry={createDiffEditorRegistry()}
				resolvedTheme="light"
				hideAddressed={false}
				currentFilePath={null}
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

describe("DiffViewerPane delete -> undo toast", () => {
	it("shows Comment deleted with Undo; Undo restores the exact pre-delete snapshot", async () => {
		const user = userEvent.setup();
		const c1 = comment({ id: "c1" });
		const reviewState = buildReviewState([c1]);
		renderPane(reviewState);

		await user.click(screen.getByRole("button", { name: "delete-c1" }));

		expect(reviewState.remove).toHaveBeenCalledWith("c1");
		expect(await screen.findByText("Comment deleted")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Undo" }));

		expect(reviewState.restore).toHaveBeenCalledTimes(1);
		expect(reviewState.restore.mock.calls[0][0]).toBe(c1);
	});

	it("second delete replaces the first toast; Undo restores only the second comment", async () => {
		const user = userEvent.setup();
		const c1 = comment({ id: "c1" });
		const c2 = comment({ id: "c2", body: "second" });
		const reviewState = buildReviewState([c1, c2]);
		renderPane(reviewState);

		await user.click(screen.getByRole("button", { name: "delete-c1" }));
		expect(await screen.findByText("Comment deleted")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "delete-c2" }));
		await screen.findByRole("button", { name: "Undo" });

		expect(screen.getAllByText("Comment deleted")).toHaveLength(1);

		await user.click(screen.getByRole("button", { name: "Undo" }));

		expect(reviewState.restore).toHaveBeenCalledTimes(1);
		expect(reviewState.restore.mock.calls[0][0]).toBe(c2);
	});

	it("failed remove shows an error toast and never offers undo", async () => {
		const user = userEvent.setup();
		const c1 = comment({ id: "c1" });
		const reviewState = buildReviewState([c1]);
		reviewState.remove.mockRejectedValueOnce(new Error("boom"));
		renderPane(reviewState);

		await user.click(screen.getByRole("button", { name: "delete-c1" }));

		expect(
			await screen.findByText("Failed to delete: boom"),
		).toBeInTheDocument();
		expect(screen.queryByText("Comment deleted")).toBeNull();
		expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
		expect(reviewState.restore).not.toHaveBeenCalled();
	});
});
