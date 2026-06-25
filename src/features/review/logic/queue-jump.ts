import type { ReviewComment } from "../../../../shared/models/review-comment";
import type { editor as MonacoEditor } from "monaco-editor";

export type JumpAction =
	| {
			type: "session/selectChangedFile";
			worktreeId: string;
			relativePath: string;
	  }
	| { type: "session/selectCommit"; worktreeId: string; sha: string }
	| {
			type: "session/selectCommitFile";
			worktreeId: string;
			relativePath: string;
	  };

export function dispatchActionsForJump(c: ReviewComment): JumpAction[] {
	if (c.source === "working-tree") {
		return [
			{
				type: "session/selectChangedFile",
				worktreeId: c.worktreeId,
				relativePath: c.filePath,
			},
		];
	}
	if (!c.commitSha) {
		throw new Error("commit-source comment is missing commitSha");
	}
	return [
		{
			type: "session/selectCommit",
			worktreeId: c.worktreeId,
			sha: c.commitSha,
		},
		{
			type: "session/selectCommitFile",
			worktreeId: c.worktreeId,
			relativePath: c.filePath,
		},
	];
}

export async function waitForEditor(
	get: () => MonacoEditor.IStandaloneDiffEditor | null,
	timeoutMs = 500,

	_now: () => number = () => Date.now(),
): Promise<MonacoEditor.IStandaloneDiffEditor | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const ed = get();
		if (ed) return ed;
		await new Promise((r) => setTimeout(r, 16));
	}
	return null;
}

/**
 * Editor-mount budget for jumps initiated from a *closed* overlay (e.g. the
 * review chip bar). Selecting the comment's file kicks off an async diff load
 * (git.readDiff IPC) before Monaco registers the editor; the 500ms default used
 * for already-open sidebar jumps is too short for that cold path. waitForEditor
 * polls every 16ms and returns the instant the editor registers, so this larger
 * budget only matters for the genuine "never mounts" case.
 */
export const COLD_JUMP_TIMEOUT_MS = 5000;

export interface CommentJumpDeps {
	dispatch: (action: JumpAction) => void;
	getEditor: () => MonacoEditor.IStandaloneDiffEditor | null;
	onResolved: (editor: MonacoEditor.IStandaloneDiffEditor) => void;
	onMissing: () => void;
	/** Defaults to 500ms (already-open sidebar jump). */
	editorTimeoutMs?: number;
}

/**
 * Dispatch the file-selection action(s) for a comment, wait for its diff editor
 * to mount, then either reveal it (onResolved) or report it missing (onMissing).
 * Pure w.r.t. React so it can be unit-tested with fake timers.
 */
export async function runCommentJump(
	comment: ReviewComment,
	deps: CommentJumpDeps,
): Promise<void> {
	const actions = dispatchActionsForJump(comment);
	for (const a of actions) deps.dispatch(a);
	const editor = await waitForEditor(
		deps.getEditor,
		deps.editorTimeoutMs ?? 500,
	);
	if (editor) deps.onResolved(editor);
	else deps.onMissing();
}
