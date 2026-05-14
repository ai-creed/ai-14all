import { z } from "zod";
import {
	ReviewCommentSchema,
	ReviewCommentSourceSchema,
} from "../models/review-comment";

export const REVIEW_LIST = "reviewComments:list" as const;
export const REVIEW_CREATE = "reviewComments:create" as const;
export const REVIEW_MARK_ADDRESSED = "reviewComments:markAddressed" as const;
export const REVIEW_REOPEN = "reviewComments:reopen" as const;
export const REVIEW_DELETE = "reviewComments:delete" as const;
export const REVIEW_REBASE = "reviewComments:rebaseWorktreeIds" as const;

export const ReviewListRequestSchema = z.object({
	worktreeId: z.string().min(1),
});
export const ReviewListResponseSchema = z.object({
	comments: z.array(ReviewCommentSchema),
});

export const ReviewCreateRequestSchema = z.object({
	worktreeId: z.string().min(1),
	filePath: z.string().min(1),
	startLine: z.number().int().min(1),
	endLine: z.number().int().min(1),
	snippet: z.string(),
	body: z.string().min(1),
	source: ReviewCommentSourceSchema,
	commitSha: z.string().nullable(),
});
export type ReviewCreateRequest = z.infer<typeof ReviewCreateRequestSchema>;
export const ReviewCreateResponseSchema = z.object({
	comment: ReviewCommentSchema,
});

export const ReviewMarkAddressedRequestSchema = z.object({
	commentId: z.string().min(1),
});
export const ReviewMarkAddressedResponseSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true) }),
	z.object({
		ok: z.literal(false),
		error: z.enum(["not_found", "already_addressed"]),
	}),
]);

export const ReviewReopenRequestSchema = z.object({
	commentId: z.string().min(1),
});
export const ReviewReopenResponseSchema = z.object({
	comment: ReviewCommentSchema.nullable(),
});

export const ReviewDeleteRequestSchema = z.object({
	commentId: z.string().min(1),
});
export const ReviewDeleteResponseSchema = z.object({
	deleted: z.boolean(),
});

export const ReviewRebaseRequestSchema = z.object({
	mapping: z.record(z.string(), z.string()),
});
export const ReviewRebaseResponseSchema = z.object({ ok: z.literal(true) });

export const REVIEW_COMMENT_CHANGED = "reviewComments:changed" as const;
export const ReviewCommentChangedEventSchema = z.object({
	kind: z.enum([
		"created",
		"updated",
		"addressed",
		"reopened",
		"deleted",
		"rebased",
	]),
});
export type ReviewCommentChangedEvent = z.infer<
	typeof ReviewCommentChangedEventSchema
>;
