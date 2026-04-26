// shared/models/review-comment.ts
import { z } from "zod";

export const ReviewCommentStatusSchema = z.enum(["open", "addressed"]);
export type ReviewCommentStatus = z.infer<typeof ReviewCommentStatusSchema>;

export const ReviewCommentSourceSchema = z.enum(["working-tree", "commit"]);
export type ReviewCommentSource = z.infer<typeof ReviewCommentSourceSchema>;

export const ReviewCommentSchema = z.object({
	id: z.string().min(1),
	worktreeId: z.string().min(1),
	filePath: z.string().min(1),
	startLine: z.number().int().min(1),
	endLine: z.number().int().min(1),
	snippet: z.string(),
	body: z.string(),
	status: ReviewCommentStatusSchema,
	source: ReviewCommentSourceSchema,
	commitSha: z.string().nullable(),
	createdAt: z.string().datetime(),
	addressedAt: z.string().datetime().nullable(),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;
