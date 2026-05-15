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
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
