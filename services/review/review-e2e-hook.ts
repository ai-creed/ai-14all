import type {
	CreateInput,
	ReviewCommentService,
} from "./review-comment-service.js";

/**
 * E2E-only seam (hero recorder): create a review comment through the SAME
 * service path the UI's REVIEW_CREATE IPC handler uses, so persistence and
 * the "created" change event (→ renderer push) both happen for real.
 */
export function makeInjectReviewComment(service: ReviewCommentService) {
	return async (input: CreateInput): Promise<{ id: string }> => {
		const comment = await service.create(input);
		return { id: comment.id };
	};
}
