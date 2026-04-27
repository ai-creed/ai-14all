import http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { ReviewCommentService } from "./review-comment-service.js";
import type { WorktreePathResolver } from "./worktree-path-resolver.js";

type Options = { port: number; host: string };

export class ReviewMcpServer {
	private httpServer: http.Server | null = null;

	constructor(
		private readonly service: ReviewCommentService,
		private readonly resolver: WorktreePathResolver,
		private readonly options: Options,
	) {}

	private registerTools(mcp: McpServer): void {
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
					content: [
						{ type: "text" as const, text: JSON.stringify(result) },
					],
				};
			},
		);
	}

	async start(): Promise<number> {
		// Each client session gets its own McpServer + transport (stateful per session)
		const sessions = new Map<string, StreamableHTTPServerTransport>();

		const server = http.createServer((req, res) => {
			void (async () => {
				const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? null;
				if (sessionId && sessions.has(sessionId)) {
					await sessions.get(sessionId)!.handleRequest(req, res);
					return;
				}
				// New session — fresh McpServer + transport
				const sessionMcp = new McpServer({ name: "ai-14all", version: "0.1.0" });
				this.registerTools(sessionMcp);
				const t: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
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
