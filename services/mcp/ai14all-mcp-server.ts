import http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { ReviewCommentService } from "../review/review-comment-service.js";
import type { WorktreePathResolver } from "../review/worktree-path-resolver.js";
import type { SessionNoteBridge } from "./session-note-bridge.js";
import {
	BridgeDisposedError,
	BridgeTimeoutError,
	RendererGoneError,
	RendererNotReadyError,
} from "./session-note-bridge.js";

type Options = { port: number; host: string };

export type SessionNoteBridgeLike = Pick<SessionNoteBridge, "read" | "append">;

export async function resolveWithRefresh(
	resolver: WorktreePathResolver,
	worktreePath: string,
): Promise<string | null> {
	const first = await resolver.resolve(worktreePath);
	if (first) return first;
	await resolver.refresh();
	return resolver.resolve(worktreePath);
}

function jsonOk(payload: Record<string, unknown>) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({ ok: true, ...payload }),
			},
		],
	};
}

function jsonError(code: string, message: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({ ok: false, error: code, message }),
			},
		],
	};
}

function mapBridgeErrorCode(err: unknown): string {
	if (err instanceof RendererNotReadyError) return "renderer_not_ready";
	if (err instanceof RendererGoneError) return "renderer_gone";
	if (err instanceof BridgeTimeoutError) return "bridge_timeout";
	if (err instanceof BridgeDisposedError) return "bridge_disposed";
	const code = (err as { code?: string } | null)?.code;
	if (code) return code;
	return "internal_error";
}

export class Ai14allMcpServer {
	private httpServer: http.Server | null = null;

	constructor(
		private readonly service: ReviewCommentService,
		private readonly resolver: WorktreePathResolver,
		private readonly noteBridge: SessionNoteBridgeLike,
		private readonly options: Options,
	) {}

	private registerTools(mcp: McpServer): void {
		this.registerReviewTools(mcp);
		this.registerNoteTools(mcp);
	}

	private registerReviewTools(mcp: McpServer): void {
		mcp.tool(
			"list_pending_reviews",
			{ worktreePath: z.string().min(1) },
			async ({ worktreePath }) => {
				const worktreeId = await this.resolver.resolve(worktreePath);
				if (!worktreeId) {
					return {
						content: [
							{ type: "text" as const, text: JSON.stringify({ reviews: [] }) },
						],
					};
				}
				const reviews = this.service
					.listOpenByWorktree(worktreeId)
					.map((c) => ({
						id: c.id,
						filePath: c.filePath,
						startLine: c.startLine,
						endLine: c.endLine,
						snippet: c.snippet,
						body: c.body,
						status: c.status,
						source: c.source,
						commitSha: c.commitSha,
						createdAt: c.createdAt,
						addressedAt: c.addressedAt,
					}));
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify({ reviews }) },
					],
				};
			},
		);

		mcp.tool(
			"mark_review_addressed",
			{ commentId: z.string().min(1) },
			async ({ commentId }) => {
				const result = await this.service.markAddressed(commentId);
				return {
					content: [{ type: "text" as const, text: JSON.stringify(result) }],
				};
			},
		);
	}

	private registerNoteTools(mcp: McpServer): void {
		mcp.tool(
			"read_session_note",
			"Read the current ai-14all session note. Useful before appending to avoid duplicates.",
			{ worktreePath: z.string().min(1) },
			async ({ worktreePath }) => {
				const worktreeId = await resolveWithRefresh(
					this.resolver,
					worktreePath,
				);
				if (!worktreeId) {
					return jsonError(
						"no_worktree",
						`no worktree at path: ${worktreePath}`,
					);
				}
				try {
					const { note } = await this.noteBridge.read(worktreeId);
					return jsonOk({ note });
				} catch (err) {
					return jsonError(
						mapBridgeErrorCode(err),
						(err as Error).message ?? "bridge error",
					);
				}
			},
		);

		mcp.tool(
			"append_session_note",
			"Append a new section to the current ai-14all session note. Call ONLY when the user explicitly asks to save / note / remember something. Do NOT call autonomously.",
			{
				worktreePath: z.string().min(1),
				title: z.string().min(1),
				body: z.string().min(1),
			},
			async ({ worktreePath, title, body }) => {
				const worktreeId = await resolveWithRefresh(
					this.resolver,
					worktreePath,
				);
				if (!worktreeId) {
					return jsonError(
						"no_worktree",
						`no worktree at path: ${worktreePath}`,
					);
				}
				try {
					const { note, appendedSection } = await this.noteBridge.append(
						worktreeId,
						title,
						body,
					);
					return jsonOk({ appendedSection, note });
				} catch (err) {
					return jsonError(
						mapBridgeErrorCode(err),
						(err as Error).message ?? "bridge error",
					);
				}
			},
		);
	}

	async start(): Promise<number> {
		// Each client session gets its own McpServer + transport (stateful per session)
		const sessions = new Map<string, StreamableHTTPServerTransport>();

		const server = http.createServer((req, res) => {
			void (async () => {
				const sessionId =
					(req.headers["mcp-session-id"] as string | undefined) ?? null;
				if (sessionId && sessions.has(sessionId)) {
					await sessions.get(sessionId)!.handleRequest(req, res);
					return;
				}
				// New session — fresh McpServer + transport
				const sessionMcp = new McpServer({
					name: "ai-14all",
					version: "0.1.0",
				});
				this.registerTools(sessionMcp);
				const t: StreamableHTTPServerTransport =
					new StreamableHTTPServerTransport({
						sessionIdGenerator: () => randomUUID(),
						onsessioninitialized: (sid) => {
							sessions.set(sid, t);
						},
						onsessionclosed: (sid) => {
							sessions.delete(sid);
						},
					});
				await sessionMcp.connect(t);
				await t.handleRequest(req, res);
			})();
		});

		const port: number = await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(this.options.port, this.options.host, () => {
				const address = server.address();
				if (typeof address === "object" && address && address.port) {
					resolve(address.port);
				} else {
					reject(new Error("could not determine bound port"));
				}
			});
		});
		this.httpServer = server;
		return port;
	}

	async stop(): Promise<void> {
		await new Promise<void>((resolve) => {
			if (!this.httpServer) return resolve();
			this.httpServer.close(() => resolve());
		});
		this.httpServer = null;
	}
}
