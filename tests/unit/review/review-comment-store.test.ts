import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewCommentStore } from "../../../services/review/review-comment-store";
import type { ReviewComment } from "../../../shared/models/review-comment";

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
	return {
		id: "id-1",
		worktreeId: "/repo",
		filePath: "src/foo.ts",
		startLine: 1,
		endLine: 1,
		snippet: "const x = 1;",
		body: "rename x",
		status: "open",
		source: "working-tree",
		commitSha: null,
		createdAt: "2026-04-26T00:00:00.000Z",
		addressedAt: null,
		...overrides,
	};
}

describe("ReviewCommentStore", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "review-store-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("loads empty list when file is missing", async () => {
		const store = new ReviewCommentStore(join(dir, "review-comments.json"));
		expect(await store.load()).toEqual([]);
	});

	it("round-trips a saved list", async () => {
		const store = new ReviewCommentStore(join(dir, "review-comments.json"));
		const c = comment();
		await store.save([c]);
		const reopened = new ReviewCommentStore(join(dir, "review-comments.json"));
		expect(await reopened.load()).toEqual([c]);
	});

	it("preserves on-disk file when JSON is invalid", async () => {
		const path = join(dir, "review-comments.json");
		await writeFile(path, "{ not json", "utf-8");
		const store = new ReviewCommentStore(path);
		expect(await store.load()).toEqual([]);
		expect(await readFile(path, "utf-8")).toBe("{ not json");
	});

	it("preserves on-disk file when version is unsupported", async () => {
		const path = join(dir, "review-comments.json");
		await writeFile(
			path,
			JSON.stringify({ version: 99, comments: [] }),
			"utf-8",
		);
		const store = new ReviewCommentStore(path);
		expect(await store.load()).toEqual([]);
		expect(await readFile(path, "utf-8")).toContain('"version":99');
	});

	it("save uses temp-then-rename (no partial file on success)", async () => {
		const path = join(dir, "review-comments.json");
		const store = new ReviewCommentStore(path);
		await store.save([comment()]);
		const text = await readFile(path, "utf-8");
		const parsed = JSON.parse(text);
		expect(parsed.version).toBe(1);
		expect(parsed.comments).toHaveLength(1);
	});
});
