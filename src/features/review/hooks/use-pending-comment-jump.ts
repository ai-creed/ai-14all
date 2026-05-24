import { useEffect } from "react";
import type { ReviewComment } from "../../../../shared/models/review-comment";
import { COLD_JUMP_TIMEOUT_MS } from "../logic/queue-jump";

type Args = {
	/** Monotonic nonce; > 0 means "jump pending". Caller resets it via onConsume. */
	nonce: number;
	comments: ReviewComment[];
	/** Reveal a comment in the diff. Receives a generous editor-mount budget. */
	jump: (comment: ReviewComment, opts: { editorTimeoutMs: number }) => void;
	/** Reset the nonce so the effect fires once per click. */
	onConsume: () => void;
};

/**
 * Reacts to the review-chip "open comments" signal: on each new nonce, jump to
 * the first OPEN comment using COLD_JUMP_TIMEOUT_MS (the overlay may have just
 * opened, so the diff editor can take longer than the 500ms sidebar default to
 * mount), then consume the nonce. Owning the timeout here keeps the cold-path
 * wiring unit-testable without rendering ReviewArea.
 */
export function usePendingCommentJump({
	nonce,
	comments,
	jump,
	onConsume,
}: Args): void {
	useEffect(() => {
		if (nonce <= 0) return;
		const first = comments.find((c) => c.status === "open");
		if (first) jump(first, { editorTimeoutMs: COLD_JUMP_TIMEOUT_MS });
		onConsume();
		// Fire once per nonce change only.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nonce]);
}
