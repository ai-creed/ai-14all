import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
	ReviewCommentSchema,
	type ReviewComment,
} from "../../shared/models/review-comment.js";

const PersistedSchema = z.object({
	version: z.literal(1),
	comments: z.array(ReviewCommentSchema),
});

export class ReviewCommentStore {
	constructor(private readonly path: string) {}

	async load(): Promise<ReviewComment[]> {
		let raw: string;
		try {
			raw = await readFile(this.path, "utf-8");
		} catch {
			return [];
		}
		try {
			const json: unknown = JSON.parse(raw);
			const parsed = PersistedSchema.safeParse(json);
			if (!parsed.success) {
				console.warn(
					"[review-comment-store] unsupported on-disk shape; using empty in-memory store and preserving file",
				);
				return [];
			}
			return parsed.data.comments;
		} catch {
			console.warn(
				"[review-comment-store] invalid JSON on disk; using empty in-memory store and preserving file",
			);
			return [];
		}
	}

	async save(comments: ReviewComment[]): Promise<void> {
		await mkdir(dirname(this.path), { recursive: true });
		const tmp = `${this.path}.ai-14all.tmp`;
		const payload = JSON.stringify({ version: 1, comments }, null, 2);
		await writeFile(tmp, payload, "utf-8");
		try {
			await rename(tmp, this.path);
		} catch (err) {
			await unlink(tmp).catch(() => {});
			throw err;
		}
	}
}
