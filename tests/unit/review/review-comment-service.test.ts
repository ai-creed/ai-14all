import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewCommentService } from "../../../services/review/review-comment-service";
import { ReviewCommentStore } from "../../../services/review/review-comment-store";
import { afterEach } from "vitest";

async function makeService() {
	const dir = await mkdtemp(join(tmpdir(), "review-svc-"));
	const store = new ReviewCommentStore(join(dir, "review-comments.json"));
	const service = new ReviewCommentService(store);
	await service.init();
	return {
		dir,
		service,
		cleanup: () => rm(dir, { recursive: true, force: true }),
	};
}

describe("ReviewCommentService", () => {
	let ctx: Awaited<ReturnType<typeof makeService>>;
	beforeEach(async () => {
		ctx = await makeService();
	});
	afterEach(async () => {
		await ctx.cleanup();
	});

	it("create assigns id, sets createdAt and defaults", async () => {
		const c = await ctx.service.create({
			worktreeId: "/repo",
			filePath: "src/foo.ts",
			startLine: 5,
			endLine: 7,
			snippet: "abc",
			body: "fix me",
			source: "working-tree",
			commitSha: null,
		});
		expect(c.id).toBeTruthy();
		expect(c.status).toBe("open");
		expect(c.addressedAt).toBeNull();
		expect(typeof c.createdAt).toBe("string");
	});

	it("listByWorktree returns only matching worktree", async () => {
		await ctx.service.create({
			worktreeId: "/a",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "x",
			source: "working-tree",
			commitSha: null,
		});
		await ctx.service.create({
			worktreeId: "/b",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "y",
			source: "working-tree",
			commitSha: null,
		});
		expect(ctx.service.listByWorktree("/a")).toHaveLength(1);
		expect(ctx.service.listByWorktree("/b")).toHaveLength(1);
	});

	it("markAddressed flips status and is idempotent", async () => {
		const c = await ctx.service.create({
			worktreeId: "/a",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "x",
			source: "working-tree",
			commitSha: null,
		});
		const r1 = await ctx.service.markAddressed(c.id);
		expect(r1).toEqual({ ok: true });
		const r2 = await ctx.service.markAddressed(c.id);
		expect(r2).toEqual({ ok: false, error: "already_addressed" });
	});

	it("markAddressed on missing id returns not_found", async () => {
		const r = await ctx.service.markAddressed("nope");
		expect(r).toEqual({ ok: false, error: "not_found" });
	});

	it("reopen clears addressedAt", async () => {
		const c = await ctx.service.create({
			worktreeId: "/a",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "x",
			source: "working-tree",
			commitSha: null,
		});
		await ctx.service.markAddressed(c.id);
		const reopened = await ctx.service.reopen(c.id);
		expect(reopened?.status).toBe("open");
		expect(reopened?.addressedAt).toBeNull();
	});

	it("delete removes the comment", async () => {
		const c = await ctx.service.create({
			worktreeId: "/a",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "x",
			source: "working-tree",
			commitSha: null,
		});
		await ctx.service.delete(c.id);
		expect(ctx.service.listByWorktree("/a")).toHaveLength(0);
	});

	it("emits a change event on create / mark / delete", async () => {
		const events: string[] = [];
		const off = ctx.service.onChange((kind) => events.push(kind));
		const c = await ctx.service.create({
			worktreeId: "/a",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "x",
			source: "working-tree",
			commitSha: null,
		});
		await ctx.service.markAddressed(c.id);
		await ctx.service.delete(c.id);
		off();
		expect(events).toEqual(["created", "addressed", "deleted"]);
	});

	it("removeByWorktree drops every comment for the worktree", async () => {
		await ctx.service.create({
			worktreeId: "/a",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "x",
			source: "working-tree",
			commitSha: null,
		});
		await ctx.service.create({
			worktreeId: "/b",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "y",
			source: "working-tree",
			commitSha: null,
		});
		await ctx.service.removeByWorktree("/a");
		expect(ctx.service.listByWorktree("/a")).toHaveLength(0);
		expect(ctx.service.listByWorktree("/b")).toHaveLength(1);
	});

	it("rebaseWorktreeIds rewrites matching ids only", async () => {
		const a = await ctx.service.create({
			worktreeId: "/old/a",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "x",
			source: "working-tree",
			commitSha: null,
		});
		const b = await ctx.service.create({
			worktreeId: "/keep",
			filePath: "f",
			startLine: 1,
			endLine: 1,
			snippet: "",
			body: "y",
			source: "working-tree",
			commitSha: null,
		});
		await ctx.service.rebaseWorktreeIds(
			new Map([["/old/a", "/new/a"]]),
		);
		expect(ctx.service.listByWorktree("/new/a")[0]?.id).toBe(a.id);
		expect(ctx.service.listByWorktree("/keep")[0]?.id).toBe(b.id);
		expect(ctx.service.listByWorktree("/old/a")).toHaveLength(0);
	});
});
