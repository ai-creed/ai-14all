import { z } from "zod";

export const ReviewedFileMarkSchema = z.object({
	filePath: z.string().min(1),
	contentHash: z.string().min(1),
});

export type ReviewedFileMark = z.infer<typeof ReviewedFileMarkSchema>;
