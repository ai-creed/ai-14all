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
export const REVIEW_RESTORE = "reviewComments:restore" as const;
export const REVIEW_REBASE = "reviewComments:rebaseWorktreeIds" as const;

export const ReviewListRequestSchema = z.object({
	worktreeId: z.string().min(1),
});
export const ReviewListResponseSchema = z.object({
	comments: z.array(ReviewCommentSchema),
});

export const ReviewCreateRequestSchema = z
	.object({
		worktreeId: z.string().min(1),
		filePath: z.string().min(1),
		startLine: z.number().int().min(1),
		endLine: z.number().int().min(1),
		snippet: z.string(),
		body: z.string().min(1),
		source: ReviewCommentSourceSchema,
		commitSha: z.string().nullable(),
	})
	.refine((d) => d.source !== "commit" || d.commitSha !== null, {
		message: "commitSha is required for commit-source comments",
		path: ["commitSha"],
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

export const ReviewRestoreRequestSchema = ReviewCommentSchema;
export const ReviewRestoreResponseSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true) }),
	z.object({
		ok: z.literal(false),
		error: z.enum(["already_exists"]),
	}),
]);

export const ReviewRebaseRequestSchema = z.object({
	mapping: z.record(z.string(), z.string()),
});
export const ReviewRebaseResponseSchema = z.object({ ok: z.literal(true) });

export const REVIEW_UPDATE = "reviewComments:update" as const;
export const REVIEW_BULK_REMOVE_ADDRESSED =
	"reviewComments:bulkRemoveAddressed" as const;

export const ReviewUpdateRequestSchema = z.object({
	commentId: z.string().min(1),
	body: z.string().min(1),
});
export type ReviewUpdateRequest = z.infer<typeof ReviewUpdateRequestSchema>;
export const ReviewUpdateResponseSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), comment: ReviewCommentSchema }),
	z.object({
		ok: z.literal(false),
		error: z.enum(["not_found", "not_open", "empty_body"]),
	}),
]);

export const ReviewBulkRemoveAddressedRequestSchema = z.object({
	worktreeId: z.string().min(1),
	ids: z.array(z.string().min(1)),
});
export const ReviewBulkRemoveAddressedResponseSchema = z.discriminatedUnion(
	"ok",
	[
		z.object({ ok: z.literal(true), removed: z.number().int().min(0) }),
		z.object({
			ok: z.literal(false),
			error: z.enum(["worktree_mismatch", "not_found", "not_addressed"]),
		}),
	],
);

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
