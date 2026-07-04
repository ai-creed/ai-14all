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
	RegisterAgentSessionInputSchema,
} from "../../../services/mcp/ai14all-mcp-server";
import { RendererNotReadyError } from "../../../services/mcp/agent-resume-bridge";
import type {
	AgentAttentionBridgeLike,
	AgentResumeBridgeLike,
	AgentAttentionLoggerLike,
} from "../../../services/mcp/ai14all-mcp-server";

function stubResolver(map: Record<string, string>) {
	return {
		resolve: vi.fn(async (p: string) => map[p] ?? null),
		refresh: vi.fn(async () => {}),
	};
}

async function makeRig(
	opts: {
		resumeBridge?: { report: ReturnType<typeof vi.fn> };
		attentionLogger?: { append: ReturnType<typeof vi.fn> };
		resolver?: ReturnType<typeof stubResolver>;
	} = {},
) {
	const dir = await mkdtemp(join(tmpdir(), "mcp-resume-rig-"));
	const store = new ReviewCommentStore(join(dir, "review-comments.json"));
	const service = new ReviewCommentService(store);
	await service.init();

	const resolver = opts.resolver ?? stubResolver({ "/repo": "wt-resolved" });

	const noteBridge = {
		read: vi.fn(async (_id: string) => ({ note: "" })),
		append: vi.fn(async (_id: string, title: string, _body: string) => ({
			note: "stub",
			appendedSection: `## ${title}`,
		})),
		dispose: vi.fn(),
	};

	const attentionBridge = { report: vi.fn().mockResolvedValue(undefined) };

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
		{ port: 0, host: "127.0.0.1" },
		attentionLogger as AgentAttentionLoggerLike,
	);
	const port = await server.start();
	const url = `http://127.0.0.1:${port}/mcp`;
	const client = new Client({ name: "test-client", version: "1.0.0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(url)));

	return {
		dir,
		server,
		client,
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

describe("register_agent_session tool", () => {
	let rig: Awaited<ReturnType<typeof makeRig>>;

	afterEach(async () => {
		await rig.cleanup();
	});

	it("validates and forwards to the resume bridge", async () => {
		rig = await makeRig();

		const result = await callTool(rig.client, "register_agent_session", {
			worktreePath: "/repo",
			terminalSessionId: "term-1",
			provider: "claude",
			resumeCommand: "claude --resume abc-123",
		});

		expect(result.ok).toBe(true);
		expect(result.worktreeId).toBe("wt-resolved");
		expect(rig.resumeBridge.report).toHaveBeenCalledOnce();
		const reported = rig.resumeBridge.report.mock.calls[0][0] as Record<
			string,
			unknown
		>;
		expect(reported).toMatchObject({
			worktreeId: "wt-resolved",
			terminalSessionId: "term-1",
			provider: "claude",
			resumeCommand: "claude --resume abc-123",
		});
		expect(typeof reported.reportedAt).toBe("number");
		// The success path is not a rejection — nothing is logged.
		expect(rig.attentionLogger.append).not.toHaveBeenCalled();
	});

	it("rejects forbidden characters without touching the bridge and logs exactly one rejection", async () => {
		rig = await makeRig();

		const result = await callTool(rig.client, "register_agent_session", {
			worktreePath: "/repo",
			terminalSessionId: "term-1",
			provider: "claude",
			resumeCommand: "claude --resume abc\nrm -rf /",
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("invalid_resume_command");
		expect(rig.resumeBridge.report).not.toHaveBeenCalled();

		expect(rig.attentionLogger.append).toHaveBeenCalledOnce();
		const logged = rig.attentionLogger.append.mock.calls[0][0] as Record<
			string,
			unknown
		>;
		expect(logged.type).toBe("mcp_resume_rejected");
		expect(logged.worktreeId).toBe("wt-resolved");
		expect(logged.provider).toBe("claude");
		expect(logged.reason).toBe("forbidden_characters");
		expect(typeof logged.ts).toBe("number");
	});

	it("rejects an unknown binary and logs the rejection", async () => {
		rig = await makeRig();

		const result = await callTool(rig.client, "register_agent_session", {
			worktreePath: "/repo",
			terminalSessionId: "term-1",
			provider: "mystery",
			resumeCommand: "totally-not-an-agent --resume x",
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("invalid_resume_command");
		expect(rig.resumeBridge.report).not.toHaveBeenCalled();
		expect(rig.attentionLogger.append).toHaveBeenCalledOnce();
		const logged = rig.attentionLogger.append.mock.calls[0][0] as Record<
			string,
			unknown
		>;
		expect(logged.type).toBe("mcp_resume_rejected");
		expect(logged.reason).toBe("unknown_binary");
	});

	it("returns no_worktree when the path is unknown, without logging or bridging", async () => {
		rig = await makeRig({ resolver: stubResolver({}) });

		const result = await callTool(rig.client, "register_agent_session", {
			worktreePath: "/unknown",
			terminalSessionId: "term-1",
			provider: "claude",
			resumeCommand: "claude --resume abc-123",
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("no_worktree");
		expect(rig.resumeBridge.report).not.toHaveBeenCalled();
		expect(rig.attentionLogger.append).not.toHaveBeenCalled();
	});

	it("maps a no_terminal bridge rejection through to the tool error", async () => {
		const err = Object.assign(new Error("no process bound to terminal"), {
			code: "no_terminal",
		});
		rig = await makeRig({
			resumeBridge: { report: vi.fn().mockRejectedValue(err) },
		});

		const result = await callTool(rig.client, "register_agent_session", {
			worktreePath: "/repo",
			terminalSessionId: "term-1",
			provider: "claude",
			resumeCommand: "claude --resume abc-123",
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("no_terminal");
	});

	it("maps RendererNotReadyError to renderer_not_ready", async () => {
		rig = await makeRig({
			resumeBridge: {
				report: vi.fn().mockRejectedValue(new RendererNotReadyError("nope")),
			},
		});

		const result = await callTool(rig.client, "register_agent_session", {
			worktreePath: "/repo",
			terminalSessionId: "term-1",
			provider: "claude",
			resumeCommand: "claude --resume abc-123",
		});

		expect(result.ok).toBe(false);
		expect(result.error).toBe("renderer_not_ready");
	});

	it("advertises register_agent_session in instructions and tool discovery", async () => {
		rig = await makeRig();

		const instructions = rig.client.getInstructions() ?? "";
		expect(instructions).toContain("register_agent_session");

		const { tools } = await rig.client.listTools();
		expect(tools.find((t) => t.name === "register_agent_session")).toBeDefined();
	});
});

describe("RegisterAgentSessionInputSchema", () => {
	it("accepts a well-formed registration", () => {
		const result = RegisterAgentSessionInputSchema.safeParse({
			worktreePath: "/repo",
			terminalSessionId: "term-1",
			provider: "claude",
			resumeCommand: "claude --resume abc-123",
		});
		expect(result.success).toBe(true);
	});

	it("rejects an empty terminalSessionId", () => {
		const result = RegisterAgentSessionInputSchema.safeParse({
			worktreePath: "/repo",
			terminalSessionId: "",
			provider: "claude",
			resumeCommand: "claude --resume abc-123",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a resumeCommand longer than the max length", () => {
		const result = RegisterAgentSessionInputSchema.safeParse({
			worktreePath: "/repo",
			terminalSessionId: "term-1",
			provider: "claude",
			resumeCommand: `claude --resume ${"x".repeat(300)}`,
		});
		expect(result.success).toBe(false);
	});
});
