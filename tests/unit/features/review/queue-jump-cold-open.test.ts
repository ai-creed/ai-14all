import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	runCommentJump,
	COLD_JUMP_TIMEOUT_MS,
} from "../../../../src/features/review/logic/queue-jump";
import type { ReviewComment } from "../../../../shared/models/review-comment";

const COMMENT: ReviewComment = {
	id: "c1",
	worktreeId: "wt1",
	filePath: "src/a.ts",
	startLine: 10,
	endLine: 12,
	snippet: "x",
	body: "b",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: new Date(0).toISOString(),
	addressedAt: null,
};

// runCommentJump only forwards the editor to onResolved, so an opaque stub is enough.
function makeStubEditor(): unknown {
	return { id: "stub-editor" };
}

describe("runCommentJump cold-open editor race", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("with the default 500ms timeout, an editor that mounts after >500ms is treated as missing", async () => {
		const stub = makeStubEditor();
		let editor: unknown = null;
		// Editor registers at 1500ms — well past the 500ms default.
		setTimeout(() => {
			editor = stub;
		}, 1500);

		const dispatch = vi.fn();
		const onResolved = vi.fn();
		const onMissing = vi.fn();

		const p = runCommentJump(COMMENT, {
			dispatch,
			getEditor: () => editor as never,
			onResolved,
			onMissing,
			// no editorTimeoutMs → default 500ms
		});

		await vi.advanceTimersByTimeAsync(600);
		await p;

		expect(dispatch).toHaveBeenCalledTimes(1); // file-selection action dispatched
		expect(onMissing).toHaveBeenCalledTimes(1);
		expect(onResolved).not.toHaveBeenCalled();
	});

	it("with COLD_JUMP_TIMEOUT_MS, the same delayed mount resolves and scrolls/focuses", async () => {
		const stub = makeStubEditor();
		let editor: unknown = null;
		setTimeout(() => {
			editor = stub;
		}, 1500);

		const onResolved = vi.fn();
		const onMissing = vi.fn();

		const p = runCommentJump(COMMENT, {
			dispatch: vi.fn(),
			getEditor: () => editor as never,
			onResolved,
			onMissing,
			editorTimeoutMs: COLD_JUMP_TIMEOUT_MS,
		});

		await vi.advanceTimersByTimeAsync(1600);
		await p;

		expect(onResolved).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith(stub);
		expect(onMissing).not.toHaveBeenCalled();
	});

	it("COLD_JUMP_TIMEOUT_MS is greater than the 500ms default", () => {
		expect(COLD_JUMP_TIMEOUT_MS).toBeGreaterThan(500);
	});
});
