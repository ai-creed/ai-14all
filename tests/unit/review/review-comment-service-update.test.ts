import { describe, expect, it, vi } from "vitest";
import { ReviewCommentService } from "../../../services/review/review-comment-service";
import type { ReviewCommentStore } from "../../../services/review/review-comment-store";

function makeStore(): ReviewCommentStore {
	return {
		load: vi.fn(async () => []),
		save: vi.fn(async () => {}),
	} as unknown as ReviewCommentStore;
}

async function seed(svc: ReviewCommentService) {
	return svc.create({
		worktreeId: "w1",
		filePath: "a.ts",
		startLine: 1,
		endLine: 1,
		snippet: "x",
		body: "old body",
		source: "working-tree",
		commitSha: null,
	});
}

describe("ReviewCommentService.update", () => {
	it("updates body and emits 'updated'", async () => {
		const store = makeStore();
		const svc = new ReviewCommentService(store);
		await svc.init();
		const c = await seed(svc);
		const kinds: string[] = [];
		svc.onChange((k) => kinds.push(k));

		const res = await svc.update(c.id, { body: "new body" });

		expect(res).toEqual({
			ok: true,
			comment: expect.objectContaining({ body: "new body" }),
		});
		expect(svc.listByWorktree("w1")[0]?.body).toBe("new body");
		expect(kinds).toEqual(["updated"]);
		expect(store.save).toHaveBeenCalled();
	});

	it("rejects when comment not found", async () => {
		const svc = new ReviewCommentService(makeStore());
		await svc.init();
		const res = await svc.update("missing", { body: "x" });
		expect(res).toEqual({ ok: false, error: "not_found" });
	});

	it("rejects when status is addressed", async () => {
		const svc = new ReviewCommentService(makeStore());
		await svc.init();
		const c = await seed(svc);
		await svc.markAddressed(c.id);
		const res = await svc.update(c.id, { body: "no" });
		expect(res).toEqual({ ok: false, error: "not_open" });
	});

	it("rejects empty body", async () => {
		const svc = new ReviewCommentService(makeStore());
		await svc.init();
		const c = await seed(svc);
		const res = await svc.update(c.id, { body: "" });
		expect(res).toEqual({ ok: false, error: "empty_body" });
	});
});
