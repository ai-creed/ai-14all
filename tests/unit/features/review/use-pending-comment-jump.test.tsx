import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePendingCommentJump } from "../../../../src/features/review/hooks/use-pending-comment-jump";
import { COLD_JUMP_TIMEOUT_MS } from "../../../../src/features/review/logic/queue-jump";
import type { ReviewComment } from "../../../../shared/models/review-comment";

function comment(id: string, status: ReviewComment["status"]): ReviewComment {
	return {
		id,
		worktreeId: "wt1",
		filePath: "src/a.ts",
		startLine: 1,
		endLine: 1,
		snippet: "x",
		body: "b",
		status,
		source: "working-tree",
		commitSha: null,
		createdAt: new Date(0).toISOString(),
		addressedAt: null,
	};
}

describe("usePendingCommentJump", () => {
	it("jumps to the first open comment with COLD_JUMP_TIMEOUT_MS and consumes the nonce", () => {
		const jump = vi.fn();
		const onConsume = vi.fn();
		const comments = [
			comment("addressed1", "addressed"),
			comment("open1", "open"),
			comment("open2", "open"),
		];

		renderHook(() =>
			usePendingCommentJump({ nonce: 1, comments, jump, onConsume }),
		);

		expect(jump).toHaveBeenCalledTimes(1);
		expect(jump).toHaveBeenCalledWith(
			expect.objectContaining({ id: "open1" }),
			{ editorTimeoutMs: COLD_JUMP_TIMEOUT_MS },
		);
		expect(onConsume).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the nonce is 0", () => {
		const jump = vi.fn();
		const onConsume = vi.fn();
		renderHook(() =>
			usePendingCommentJump({
				nonce: 0,
				comments: [comment("open1", "open")],
				jump,
				onConsume,
			}),
		);
		expect(jump).not.toHaveBeenCalled();
		expect(onConsume).not.toHaveBeenCalled();
	});

	it("consumes the nonce even when there is no open comment to jump to", () => {
		const jump = vi.fn();
		const onConsume = vi.fn();
		renderHook(() =>
			usePendingCommentJump({
				nonce: 1,
				comments: [comment("a1", "addressed")],
				jump,
				onConsume,
			}),
		);
		expect(jump).not.toHaveBeenCalled();
		expect(onConsume).toHaveBeenCalledTimes(1);
	});
});
