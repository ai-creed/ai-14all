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
	ReportSessionStatusInputSchema,
} from "../../../services/mcp/ai14all-mcp-server";
import {
	BridgeTimeoutError,
	RendererNotReadyError,
} from "../../../services/mcp/agent-attention-bridge";
import type {
	AgentAttentionBridgeLike,
	AgentResumeBridgeLike,
	AgentAttentionLoggerLike,
} from "../../../services/mcp/ai14all-mcp-server";

function stubResolver(map: Record<string, string>) {
	return {
		resolve: vi.fn(async (p: string) => map[p] ?? null),
		refresh: vi.fn(async () => {
			// no dynamic behaviour needed — resolve still consults the same map
		}),
	};
}

async function makeRig(
	opts: {
		attentionBridge?: { report: ReturnType<typeof vi.fn> };
		resumeBridge?: { report: ReturnType<typeof vi.fn> };
		attentionLogger?: { append: ReturnType<typeof vi.fn> };
		resolver?: ReturnType<typeof stubResolver>;
	} = {},
) {
	const dir = await mkdtemp(join(tmpdir(), "mcp-attention-rig-"));
	const store = new ReviewCommentStore(join(dir, "review-comments.json"));
	const service = new ReviewCommentService(store);
	await service.init();

	const resolver = opts.resolver ?? stubResolver({ "/abs/wt-1": "w1" });

	const noteBridge = {
		read: vi.fn(async (_id: string) => ({ note: "" })),
		append: vi.fn(async (_id: string, title: string, _body: string) => ({
			note: "stub",
			appendedSection: `## ${title} — 2026-04-28 14:32`,
		})),
		dispose: vi.fn(),
	};

	const attentionBridge = opts.attentionBridge ?? {
		report: vi.fn().mockResolvedValue(undefined),
	};

	const resumeBridge = opts.resumeBridge ?? {
		report: vi.fn().mockResolvedValue(undefined),
	};

	const attentionLogger = opts.attentionLogger ?? {
		append: vi.fn().mockResolvedValue(undefined),
	};

	const server = new Ai14allMcpServer(
		service,
		resolver,
		noteBridge,
		attentionBridge as AgentAttentionBridgeLike,
		resumeBridge as AgentResumeBridgeLike,
		{
			port: 0,
			host: "127.0.0.1",
		},
		attentionLogger as AgentAttentionLoggerLike,
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
		noteBridge,
		attentionBridge,
		resumeBridge,
		attentionLogger,
		resolver,
		cleanup: async () => {
			await client.close();
			await server.stop();
			await rm(dir, { recursive: true, force: true });
		},
	};
}

async function callTool(
	client: Client,
	name: string,
	args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const result = await client.callTool({ name, arguments: args });
	const content = result.content as Array<{ type: string; text: string }>;
	return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("report_session_status tool", () => {
	let rig: Awaited<ReturnType<typeof makeRig>>;

	afterEach(async () => {
		await rig.cleanup();
	});

	it("returns ok payload on success", async () => {
		rig = await makeRig({
			resolver: stubResolver({ "/abs/wt-1": "w1" }),
		});

		const result = await callTool(rig.client, "report_session_status", {
			worktreePath: "/abs/wt-1",
			state: "ready",
			summary: "done",
			nextAction: null,
		});

		expect(result.ok).toBe(true);
		expect(result.worktreeId).toBe("w1");
		expect(result.state).toBe("ready");
		expect(typeof result.reportedAt).toBe("number");
		expect(rig.attentionBridge.report).toHaveBeenCalledOnce();
		const callArg = rig.attentionBridge.report.mock.calls[0][0] as Record<
			string,
			unknown
		>;
		expect(callArg.worktreeId).toBe("w1");
		expect(callArg.state).toBe("ready");
		expect(callArg.summary).toBe("done");
		expect(callArg.nextAction).toBeNull();
	});

	it("forwards resolved worktreeId and task to the bridge", async () => {
		rig = await makeRig({
			resolver: stubResolver({ "/abs/wt-1": "w1" }),
		});

		const result = await callTool(rig.client, "report_session_status", {
			worktreePath: "/abs/wt-1",
			state: "active",
			summary: "working",
			nextAction: null,
			task: "Review the spec at docs/foo.md",
		});

		expect(result.ok).toBe(true);
		expect(rig.attentionBridge.report).toHaveBeenCalledOnce();
		const callArg = rig.attentionBridge.report.mock.calls[0][0] as Record<
			string,
			unknown
		>;
		expect(callArg.worktreeId).toBe("w1");
		expect(callArg.task).toBe("Review the spec at docs/foo.md");
	});

	it("appends an mcp diagnostic event with resolved worktreeId and null provider", async () => {
		rig = await makeRig({
			resolver: stubResolver({ "/abs/wt-1": "w1" }),
		});

		await callTool(rig.client, "report_session_status", {
			worktreePath: "/abs/wt-1",
			state: "waiting",
			summary: "awaiting answer",
			nextAction: "answer the question",
			task: "Implement Task 9",
		});

		expect(rig.attentionLogger.append).toHaveBeenCalledOnce();
		const logged = rig.attentionLogger.append.mock.calls[0][0] as Record<
			string,
			unknown
		>;
		expect(logged.type).toBe("mcp");
		expect(logged.worktreeId).toBe("w1");
		expect(logged.provider).toBeNull();
		expect(logged.state).toBe("waiting");
		expect(logged.summary).toBe("awaiting answer");
		expect(logged.task).toBe("Implement Task 9");
		expect(logged.nextAction).toBe("answer the question");
		expect(typeof logged.ts).toBe("number");
	});

	it("does not append a diagnostic event when the worktree path is unknown", async () => {
		rig = await makeRig({ resolver: stubResolver({}) });

		await callTool(rig.client, "report_session_status", {
			worktreePath: "/unknown",
			state: "ready",
			summary: "done",
			nextAction: null,
		});

		expect(rig.attentionLogger.append).not.toHaveBeenCalled();
	});

	it("returns no_worktree when path not found", async () => {
		rig = await makeRig({ resolver: stubResolver({}) });

		const result = await callTool(rig.client, "report_session_status", {
			worktreePath: "/unknown",
			state: "ready",
			summary: "done",
			nextAction: null,
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("no_worktree");
		expect(rig.attentionBridge.report).not.toHaveBeenCalled();
	});

	it("maps BridgeTimeoutError to bridge_timeout", async () => {
		const attentionBridge = {
			report: vi.fn().mockRejectedValue(new BridgeTimeoutError("timeout")),
		};
		rig = await makeRig({
			resolver: stubResolver({ "/abs/wt-1": "w1" }),
			attentionBridge,
		});

		const result = await callTool(rig.client, "report_session_status", {
			worktreePath: "/abs/wt-1",
			state: "active",
			summary: "working",
			nextAction: null,
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("bridge_timeout");
	});

	it("maps RendererNotReadyError to renderer_not_ready", async () => {
		const attentionBridge = {
			report: vi.fn().mockRejectedValue(new RendererNotReadyError("not ready")),
		};
		rig = await makeRig({
			resolver: stubResolver({ "/abs/wt-1": "w1" }),
			attentionBridge,
		});

		const result = await callTool(rig.client, "report_session_status", {
			worktreePath: "/abs/wt-1",
			state: "waiting",
			summary: "pending user",
			nextAction: "wait for input",
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("renderer_not_ready");
	});

	it("rejects invalid state values", async () => {
		rig = await makeRig({ resolver: stubResolver({ "/abs/wt-1": "w1" }) });

		// Zod validation: "blocked" is not in the enum ["active","waiting","ready","failed"]
		await expect(
			callTool(rig.client, "report_session_status", {
				worktreePath: "/abs/wt-1",
				state: "blocked",
				summary: "done",
				nextAction: null,
			}),
		).rejects.toThrow();
	});

	it("rejects stale state (not in agent-reportable enum)", async () => {
		rig = await makeRig({ resolver: stubResolver({ "/abs/wt-1": "w1" }) });

		await expect(
			callTool(rig.client, "report_session_status", {
				worktreePath: "/abs/wt-1",
				state: "stale",
				summary: "done",
				nextAction: null,
			}),
		).rejects.toThrow();
	});

	it("rejects idle state (not in agent-reportable enum)", async () => {
		rig = await makeRig({ resolver: stubResolver({ "/abs/wt-1": "w1" }) });

		await expect(
			callTool(rig.client, "report_session_status", {
				worktreePath: "/abs/wt-1",
				state: "idle",
				summary: "done",
				nextAction: null,
			}),
		).rejects.toThrow();
	});
});

describe("ai-14all MCP server instructions and discovery", () => {
	let rig: Awaited<ReturnType<typeof makeRig>>;

	afterEach(async () => {
		await rig.cleanup();
	});

	it("exposes server-level instructions covering every tool and lifecycle state", async () => {
		rig = await makeRig();

		const instructions = rig.client.getInstructions();
		expect(instructions, "server instructions must be set").toBeTruthy();
		const text = instructions ?? "";

		for (const toolName of [
			"list_pending_reviews",
			"mark_review_addressed",
			"read_session_note",
			"append_session_note",
			"report_session_status",
		]) {
			expect(text, `instructions must mention ${toolName}`).toContain(toolName);
		}

		for (const state of ["active", "waiting", "ready", "failed"]) {
			expect(text, `instructions must mention state "${state}"`).toContain(
				state,
			);
		}
	});

	it("report_session_status tool description names every lifecycle state", async () => {
		rig = await makeRig();

		const { tools } = await rig.client.listTools();
		const tool = tools.find((t) => t.name === "report_session_status");
		expect(tool, "report_session_status must be registered").toBeDefined();
		const description = tool?.description ?? "";

		for (const state of ["active", "waiting", "ready", "failed"]) {
			expect(
				description,
				`description must mention state "${state}"`,
			).toContain(state);
		}
	});
});

describe("ReportSessionStatusInputSchema with task field", () => {
	it("accepts task as a string ≤200 chars", () => {
		const result = ReportSessionStatusInputSchema.safeParse({
			worktreePath: "/repos/example",
			state: "active",
			summary: "Working",
			nextAction: null,
			task: "Review the spec at docs/foo.md",
		});
		expect(result.success).toBe(true);
	});

	it("accepts task as null", () => {
		const result = ReportSessionStatusInputSchema.safeParse({
			worktreePath: "/repos/example",
			state: "active",
			summary: "Working",
			nextAction: null,
			task: null,
		});
		expect(result.success).toBe(true);
	});

	it("accepts omitted task (undefined)", () => {
		const result = ReportSessionStatusInputSchema.safeParse({
			worktreePath: "/repos/example",
			state: "active",
			summary: "Working",
			nextAction: null,
		});
		expect(result.success).toBe(true);
	});

	it("rejects task longer than 200 chars", () => {
		const result = ReportSessionStatusInputSchema.safeParse({
			worktreePath: "/repos/example",
			state: "active",
			summary: "Working",
			nextAction: null,
			task: "x".repeat(201),
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty string task", () => {
		const result = ReportSessionStatusInputSchema.safeParse({
			worktreePath: "/repos/example",
			state: "active",
			summary: "Working",
			nextAction: null,
			task: "",
		});
		expect(result.success).toBe(false);
	});

	it("accepts task of exactly 200 chars", () => {
		const result = ReportSessionStatusInputSchema.safeParse({
			worktreePath: "/repos/example",
			state: "active",
			summary: "Working",
			nextAction: null,
			task: "x".repeat(200),
		});
		expect(result.success).toBe(true);
	});

	it("accepts task of exactly 1 char", () => {
		const result = ReportSessionStatusInputSchema.safeParse({
			worktreePath: "/repos/example",
			state: "active",
			summary: "Working",
			nextAction: null,
			task: "x",
		});
		expect(result.success).toBe(true);
	});
});
