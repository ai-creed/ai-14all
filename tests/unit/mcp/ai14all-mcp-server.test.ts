import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ReviewCommentService } from "../../../services/review/review-comment-service";
import { ReviewCommentStore } from "../../../services/review/review-comment-store";
import {
	Ai14allMcpServer,
	resolveWithRefresh,
} from "../../../services/mcp/ai14all-mcp-server";
import {
	BridgeTimeoutError,
	RendererNotReadyError,
} from "../../../services/mcp/session-note-bridge";

async function makeRig(opts: { resolveResult?: string | null } = {}) {
	const dir = await mkdtemp(join(tmpdir(), "mcp-rig-"));
	const store = new ReviewCommentStore(join(dir, "review-comments.json"));
	const service = new ReviewCommentService(store);
	await service.init();
	const resolved =
		opts.resolveResult === undefined ? "/repo" : opts.resolveResult;
	const resolver = {
		resolve: vi.fn(async (_p: string) => (resolved === null ? null : "/repo")),
		refresh: vi.fn(async () => {}),
	};
	const bridge = {
		read: vi.fn(async (_id: string) => ({ note: "" })),
		append: vi.fn(async (_id: string, title: string, _body: string) => ({
			note: "stub",
			appendedSection: `## ${title} — 2026-04-28 14:32`,
		})),
		dispose: vi.fn(),
	};
	const attentionBridge = {
		report: vi.fn(async () => {}),
	};
	const server = new Ai14allMcpServer(
		service,
		resolver,
		bridge,
		attentionBridge,
		{
			port: 0,
			host: "127.0.0.1",
		},
	);
	const port = await server.start();
	const url = `http://127.0.0.1:${port}/mcp`;
	const client = new Client({ name: "test-client", version: "1.0.0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(url)));
	return {
		dir,
		service,
		server,
		client,
		bridge,
		resolver,
		cleanup: async () => {
			await client.close();
			await server.stop();
			await rm(dir, { recursive: true, force: true });
		},
	};
}

describe("Ai14allMcpServer", () => {
	let rig: Awaited<ReturnType<typeof makeRig>>;

	afterEach(async () => {
		await rig.cleanup();
	});

	it("list_pending_reviews returns only open comments for matching worktree", async () => {
		rig = await makeRig();
		const { service, client } = rig;

		// open comment in target worktree
		await service.create({
			worktreeId: "/repo",
			filePath: "src/index.ts",
			startLine: 1,
			endLine: 3,
			snippet: "const x = 1",
			body: "Fix this please",
			source: "working-tree",
			commitSha: null,
		});

		// addressed comment in same worktree — should be excluded
		const addressed = await service.create({
			worktreeId: "/repo",
			filePath: "src/index.ts",
			startLine: 5,
			endLine: 5,
			snippet: "const y = 2",
			body: "Already fixed",
			source: "working-tree",
			commitSha: null,
		});
		await service.markAddressed(addressed.id);

		// open comment in different worktree — should be excluded
		await service.create({
			worktreeId: "/other-repo",
			filePath: "src/other.ts",
			startLine: 1,
			endLine: 1,
			snippet: "const z = 3",
			body: "Different worktree",
			source: "working-tree",
			commitSha: null,
		});

		const result = await client.callTool({
			name: "list_pending_reviews",
			arguments: { worktreePath: "/repo" },
		});

		const content = result.content as Array<{ type: string; text: string }>;
		const parsed = JSON.parse(content[0].text) as { reviews: unknown[] };
		expect(parsed.reviews).toHaveLength(1);
		expect((parsed.reviews[0] as { body: string }).body).toBe(
			"Fix this please",
		);
	});

	it("mark_review_addressed flips status; second call returns already_addressed", async () => {
		rig = await makeRig();
		const { service, client } = rig;

		const comment = await service.create({
			worktreeId: "/repo",
			filePath: "src/index.ts",
			startLine: 1,
			endLine: 1,
			snippet: "const x = 1",
			body: "Review comment",
			source: "working-tree",
			commitSha: null,
		});

		const first = await client.callTool({
			name: "mark_review_addressed",
			arguments: { commentId: comment.id },
		});
		const firstContent = first.content as Array<{ type: string; text: string }>;
		const firstParsed = JSON.parse(firstContent[0].text) as { ok: boolean };
		expect(firstParsed.ok).toBe(true);

		const second = await client.callTool({
			name: "mark_review_addressed",
			arguments: { commentId: comment.id },
		});
		const secondContent = second.content as Array<{
			type: string;
			text: string;
		}>;
		const secondParsed = JSON.parse(secondContent[0].text) as {
			ok: boolean;
			error: string;
		};
		expect(secondParsed.ok).toBe(false);
		expect(secondParsed.error).toBe("already_addressed");
	});
});

describe("resolveWithRefresh", () => {
	it("returns id on first try without refresh", async () => {
		const refresh = vi.fn(async () => {});
		const resolver = {
			resolve: vi.fn(async (_p: string) => "wt-1"),
			refresh,
		};
		const id = await resolveWithRefresh(resolver, "/path");
		expect(id).toBe("wt-1");
		expect(refresh).not.toHaveBeenCalled();
	});

	it("refreshes once and re-resolves on first null", async () => {
		const refresh = vi.fn(async () => {});
		let calls = 0;
		const resolver = {
			resolve: vi.fn(async () => (calls++ === 0 ? null : "wt-2")),
			refresh,
		};
		const id = await resolveWithRefresh(resolver, "/path");
		expect(id).toBe("wt-2");
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(resolver.resolve).toHaveBeenCalledTimes(2);
	});

	it("returns null after refresh-and-retry still misses (no infinite loop)", async () => {
		const refresh = vi.fn(async () => {});
		const resolver = {
			resolve: vi.fn(async () => null),
			refresh,
		};
		const id = await resolveWithRefresh(resolver, "/path");
		expect(id).toBeNull();
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(resolver.resolve).toHaveBeenCalledTimes(2);
	});
});

describe("read_session_note", () => {
	let rig: Awaited<ReturnType<typeof makeRig>>;
	afterEach(async () => {
		await rig.cleanup();
	});

	it("returns the note for the resolved worktree", async () => {
		rig = await makeRig();
		rig.bridge.read.mockResolvedValueOnce({ note: "existing note" });

		const result = await rig.client.callTool({
			name: "read_session_note",
			arguments: { worktreePath: "/repo" },
		});
		const content = result.content as Array<{ type: string; text: string }>;
		const parsed = JSON.parse(content[0].text);
		expect(parsed).toEqual({ ok: true, note: "existing note" });
		expect(rig.bridge.read).toHaveBeenCalledWith("/repo");
	});

	it("returns no_worktree when resolver yields null even after refresh", async () => {
		rig = await makeRig({ resolveResult: null });
		const result = await rig.client.callTool({
			name: "read_session_note",
			arguments: { worktreePath: "/missing" },
		});
		const content = result.content as Array<{ type: string; text: string }>;
		const parsed = JSON.parse(content[0].text);
		expect(parsed.ok).toBe(false);
		expect(parsed.error).toBe("no_worktree");
	});

	it("maps RendererNotReadyError to renderer_not_ready", async () => {
		rig = await makeRig();
		rig.bridge.read.mockRejectedValueOnce(new RendererNotReadyError("nope"));
		const result = await rig.client.callTool({
			name: "read_session_note",
			arguments: { worktreePath: "/repo" },
		});
		const parsed = JSON.parse(
			(result.content as Array<{ text: string }>)[0].text,
		);
		expect(parsed).toEqual({
			ok: false,
			error: "renderer_not_ready",
			message: expect.any(String),
		});
	});
});

describe("append_session_note", () => {
	let rig: Awaited<ReturnType<typeof makeRig>>;
	afterEach(async () => {
		await rig.cleanup();
	});

	it("forwards bridge.append result including appendedSection", async () => {
		rig = await makeRig();
		rig.bridge.append.mockResolvedValueOnce({
			note: "## Idea — 2026-04-28 14:32\n\nbody",
			appendedSection: "## Idea — 2026-04-28 14:32",
		});
		const result = await rig.client.callTool({
			name: "append_session_note",
			arguments: { worktreePath: "/repo", title: "Idea", body: "body" },
		});
		const parsed = JSON.parse(
			(result.content as Array<{ text: string }>)[0].text,
		);
		expect(parsed).toEqual({
			ok: true,
			appendedSection: "## Idea — 2026-04-28 14:32",
			note: "## Idea — 2026-04-28 14:32\n\nbody",
		});
		expect(rig.bridge.append).toHaveBeenCalledWith("/repo", "Idea", "body");
	});

	it("uses resolveWithRefresh: succeeds when first resolve is null but refresh fixes it", async () => {
		rig = await makeRig();
		rig.resolver.resolve
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce("/repo");
		rig.bridge.append.mockResolvedValueOnce({
			note: "n",
			appendedSection: "## t — ts",
		});
		const result = await rig.client.callTool({
			name: "append_session_note",
			arguments: { worktreePath: "/repo", title: "t", body: "b" },
		});
		const parsed = JSON.parse(
			(result.content as Array<{ text: string }>)[0].text,
		);
		expect(parsed.ok).toBe(true);
		expect(rig.resolver.refresh).toHaveBeenCalledTimes(1);
	});

	it("returns no_worktree when both resolves miss", async () => {
		rig = await makeRig();
		rig.resolver.resolve.mockResolvedValue(null);
		const result = await rig.client.callTool({
			name: "append_session_note",
			arguments: { worktreePath: "/x", title: "t", body: "b" },
		});
		const parsed = JSON.parse(
			(result.content as Array<{ text: string }>)[0].text,
		);
		expect(parsed.ok).toBe(false);
		expect(parsed.error).toBe("no_worktree");
	});

	it("maps BridgeTimeoutError to bridge_timeout", async () => {
		rig = await makeRig();
		rig.bridge.append.mockRejectedValueOnce(new BridgeTimeoutError("t"));
		const result = await rig.client.callTool({
			name: "append_session_note",
			arguments: { worktreePath: "/repo", title: "t", body: "b" },
		});
		const parsed = JSON.parse(
			(result.content as Array<{ text: string }>)[0].text,
		);
		expect(parsed.error).toBe("bridge_timeout");
	});
});
