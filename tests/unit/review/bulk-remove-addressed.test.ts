import { describe, expect, it, vi } from "vitest";
import { ReviewCommentService } from "../../../services/review/review-comment-service";
import type { ReviewCommentStore } from "../../../services/review/review-comment-store";

function makeStore(): ReviewCommentStore {
	return {
		load: vi.fn(async () => []),
		save: vi.fn(async () => {}),
	} as unknown as ReviewCommentStore;
}

async function seed(svc: ReviewCommentService, worktreeId: string, body = "b") {
	return svc.create({
		worktreeId,
		filePath: "a.ts",
		startLine: 1,
		endLine: 1,
		snippet: "x",
		body,
		source: "working-tree",
		commitSha: null,
	});
}

describe("ReviewCommentService.bulkRemoveAddressed", () => {
	it("removes all matching addressed comments and emits once", async () => {
		const store = makeStore();
		const svc = new ReviewCommentService(store);
		await svc.init();
		const a = await seed(svc, "w1", "a");
		const b = await seed(svc, "w1", "b");
		await svc.markAddressed(a.id);
		await svc.markAddressed(b.id);
		const kinds: string[] = [];
		svc.onChange((k) => kinds.push(k));

		const res = await svc.bulkRemoveAddressed({ worktreeId: "w1", ids: [a.id, b.id] });

		expect(res).toEqual({ ok: true, removed: 2 });
		expect(svc.listByWorktree("w1")).toHaveLength(0);
		expect(kinds).toEqual(["deleted"]);
		expect(store.save).toHaveBeenCalled();
	});

	it("rejects on worktree mismatch and persists nothing", async () => {
		const svc = new ReviewCommentService(makeStore());
		await svc.init();
		const a = await seed(svc, "w1");
		const b = await seed(svc, "w2");
		await svc.markAddressed(a.id);
		await svc.markAddressed(b.id);

		const res = await svc.bulkRemoveAddressed({ worktreeId: "w1", ids: [a.id, b.id] });

		expect(res).toEqual({ ok: false, error: "worktree_mismatch" });
		expect(svc.listByWorktree("w1")).toHaveLength(1);
		expect(svc.listByWorktree("w2")).toHaveLength(1);
	});

	it("rejects when any id is still open", async () => {
		const svc = new ReviewCommentService(makeStore());
		await svc.init();
		const a = await seed(svc, "w1");
		const b = await seed(svc, "w1");
		await svc.markAddressed(a.id);

		const res = await svc.bulkRemoveAddressed({ worktreeId: "w1", ids: [a.id, b.id] });

		expect(res).toEqual({ ok: false, error: "not_addressed" });
		expect(svc.listByWorktree("w1")).toHaveLength(2);
	});

	it("rejects when an id does not exist", async () => {
		const svc = new ReviewCommentService(makeStore());
		await svc.init();
		const a = await seed(svc, "w1");
		await svc.markAddressed(a.id);

		const res = await svc.bulkRemoveAddressed({ worktreeId: "w1", ids: [a.id, "missing"] });

		expect(res).toEqual({ ok: false, error: "not_found" });
		expect(svc.listByWorktree("w1")).toHaveLength(1);
	});

	it("succeeds with empty ids (no-op)", async () => {
		const svc = new ReviewCommentService(makeStore());
		await svc.init();
		const kinds: string[] = [];
		svc.onChange((k) => kinds.push(k));

		const res = await svc.bulkRemoveAddressed({ worktreeId: "w1", ids: [] });

		expect(res).toEqual({ ok: true, removed: 0 });
		expect(kinds).toEqual([]);
	});
});
