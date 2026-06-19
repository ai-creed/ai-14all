import { randomUUID } from "node:crypto";
import pty from "node-pty";
import type { IPty } from "node-pty";
import type { TerminalSession } from "../../shared/models/terminal-session.js";
import type { AgentAttentionLogger } from "../diagnostics/agent-attention-logger.js";
import type { ShellEventLogInput } from "../diagnostics/shell-event-log-service.js";
import { resolveDefaultShell } from "../platform/default-shell.js";
import { OutputBatcher } from "./output-batcher.js";

/**
 * Narrow view of the agent-attention logger the terminal service needs — just
 * `append`. Mirrors `AgentAttentionLoggerLike` in the MCP server so the same
 * singleton (constructed in electron/main/index.ts, threaded via ipc.ts) can
 * be injected without coupling this Electron-agnostic service to the class.
 */
export type AgentAttentionLoggerLike = Pick<AgentAttentionLogger, "append">;

const OUTPUT_BATCH_WINDOW_MS = Number(
	process.env.AI14ALL_TERMINAL_BATCH_MS ?? 16,
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TerminalEventHandlers = {
	onOutput: (sessionId: string, data: string) => void;
	onExit: (sessionId: string, exitCode: number, signal?: number) => void;
	onState: (sessionId: string, status: TerminalSession["status"]) => void;
	onError: (sessionId: string, message: string) => void;
};

type ActiveTerminalSession = {
	meta: TerminalSession;
	pty: IPty;
};

// ---------------------------------------------------------------------------
// TerminalService
//
// Manages the lifecycle of PTY-backed terminal sessions. The service is
// Electron-agnostic — it communicates outward exclusively through the
// TerminalEventHandlers callbacks supplied at construction time.
// ---------------------------------------------------------------------------
export class TerminalService {
	private readonly sessions = new Map<string, ActiveTerminalSession>();
	private readonly handlers: TerminalEventHandlers;
	private readonly shellEventLog?: { log: (event: ShellEventLogInput) => void };
	private readonly attentionLogger?: AgentAttentionLoggerLike;
	private disposed = false;

	constructor(
		handlers: TerminalEventHandlers,
		shellEventLog?: { log: (event: ShellEventLogInput) => void },
		attentionLogger?: AgentAttentionLoggerLike,
	) {
		this.handlers = handlers;
		this.shellEventLog = shellEventLog;
		this.attentionLogger = attentionLogger;
	}

	/**
	 * Best-effort lifecycle diagnostic emit. Never blocks or throws into the
	 * spawn/exit path. `provider` is `null`: this layer spawns a login shell,
	 * not the agent directly, so the running provider is unknown here (same
	 * rationale as the MCP-side null-provider emits).
	 *
	 * The id carried is this service's backend `TerminalSession.id`, emitted as
	 * `terminalSessionId` (NOT `processId`). The renderer `ProcessSession.id`
	 * that classifier/resolution events use is an independent id minted in the
	 * renderer only after `create()` returns, so it is not available here.
	 * Analysts join lifecycle to classifier/resolution by `worktreeId` + time,
	 * and to a concrete `ProcessSession` via its `terminalSessionId` field.
	 */
	private emitLifecycle(
		worktreeId: string,
		terminalSessionId: string,
		state: "active" | "failed",
		exitCode: number | null,
	): void {
		this.attentionLogger
			?.append({
				type: "lifecycle",
				ts: Date.now(),
				worktreeId,
				terminalSessionId,
				provider: null,
				state,
				exitCode,
			})
			.catch(() => {});
	}

	// -----------------------------------------------------------------------
	// create
	// -----------------------------------------------------------------------
	create(
		workspaceId: string,
		worktreeId: string,
		cwd: string,
	): TerminalSession {
		if (this.disposed) {
			throw new Error("Terminal service has been disposed");
		}

		const id = randomUUID();

		this.shellEventLog?.log({
			source: "main",
			event: "terminal-create-start",
			windowId: null,
			data: { workspaceId, worktreeId, cwd },
		});

		const { shell, args } = resolveDefaultShell();

		let p: IPty;
		try {
			p = pty.spawn(shell, args, {
				name: "xterm-256color",
				cols: 80,
				rows: 24,
				cwd,
				env: process.env as Record<string, string>,
			});
		} catch (err: unknown) {
			const meta: TerminalSession = {
				id,
				workspaceId,
				worktreeId,
				cwd,
				status: "error",
				exitCode: null,
			};
			const message =
				err instanceof Error ? err.message : "Failed to spawn PTY";
			this.shellEventLog?.log({
				source: "main",
				event: "terminal-create-failed",
				windowId: null,
				data: { terminalSessionId: id, workspaceId, worktreeId, cwd, message },
			});
			this.emitLifecycle(worktreeId, id, "failed", null);
			this.handlers.onState(id, "error");
			this.handlers.onError(id, message);
			return meta;
		}

		const meta: TerminalSession = {
			id,
			workspaceId,
			worktreeId,
			cwd,
			status: "running",
			exitCode: null,
		};

		this.sessions.set(id, { meta, pty: p });

		this.emitLifecycle(worktreeId, id, "active", null);

		this.shellEventLog?.log({
			source: "main",
			event: "terminal-create-success",
			windowId: null,
			data: {
				terminalSessionId: id,
				workspaceId,
				worktreeId,
				cwd,
				liveBackendSessionIds: this.listSessions().map((s) => s.id),
			},
		});
		this.shellEventLog?.log({
			source: "main",
			event: "terminal-session-registered",
			windowId: null,
			data: {
				terminalSessionId: id,
				workspaceId,
				worktreeId,
				cwd,
				liveBackendSessionIds: this.listSessions().map((s) => s.id),
			},
		});

		// Broadcast initial state
		if (!this.disposed) {
			this.handlers.onState(id, "running");
		}

		// Forward PTY output through a batcher to bound IPC event rate.
		const batcher = new OutputBatcher(OUTPUT_BATCH_WINDOW_MS, (data) => {
			if (this.disposed) return;
			this.handlers.onOutput(id, data);
		});

		p.onData((data: string) => {
			if (this.disposed) return;
			this.shellEventLog?.log({
				source: "main",
				event: "terminal-output",
				windowId: null,
				data: {
					terminalSessionId: id,
					workspaceId,
					worktreeId,
					text: data,
					hex: Buffer.from(data, "utf8").toString("hex"),
					byteLength: Buffer.byteLength(data, "utf8"),
					truncated: false,
				},
			});
			batcher.push(data);
		});

		// Handle PTY exit
		p.onExit(({ exitCode, signal }) => {
			if (this.disposed) return;
			batcher.drain();
			const session = this.sessions.get(id);
			if (!session) return; // Already cleaned up (e.g. dispose() was called)
			session.meta.status = "exited";
			session.meta.exitCode = exitCode;
			this.shellEventLog?.log({
				source: "main",
				event: "terminal-exit",
				windowId: null,
				reasonKind: "process_exit",
				reason: "pty_exit",
				isExpected: false,
				data: {
					terminalSessionId: id,
					workspaceId,
					worktreeId,
					exitCode,
					signal,
				},
			});
			this.emitLifecycle(
				worktreeId,
				id,
				exitCode && exitCode !== 0 ? "failed" : "active",
				exitCode ?? null,
			);
			this.handlers.onState(id, "exited");
			this.handlers.onExit(id, exitCode, signal);
			this.sessions.delete(id);
		});

		return meta;
	}

	// -----------------------------------------------------------------------
	// listSessions — pure read from the sessions Map
	// -----------------------------------------------------------------------
	listSessions(workspaceId?: string): TerminalSession[] {
		const all = [...this.sessions.values()].map((session) => session.meta);
		if (workspaceId !== undefined) {
			return all.filter((session) => session.workspaceId === workspaceId);
		}
		return all;
	}

	// -----------------------------------------------------------------------
	// sendInput
	// -----------------------------------------------------------------------
	sendInput(sessionId: string, data: string): void {
		if (this.disposed) {
			throw new Error("Terminal service has been disposed");
		}
		const session = this.sessions.get(sessionId);
		if (!session) {
			this.shellEventLog?.log({
				source: "main",
				event: "terminal-session-missing",
				windowId: null,
				data: { terminalSessionId: sessionId, operation: "sendInput" },
			});
			throw new Error(`Terminal session not found: ${sessionId}`);
		}
		const { meta } = session;
		this.shellEventLog?.log({
			source: "main",
			event: "terminal-send-input",
			windowId: null,
			data: {
				terminalSessionId: sessionId,
				workspaceId: meta.workspaceId,
				worktreeId: meta.worktreeId,
				text: data,
				hex: Buffer.from(data, "utf8").toString("hex"),
				byteLength: Buffer.byteLength(data, "utf8"),
				truncated: false,
			},
		});
		session.pty.write(data);
	}

	// -----------------------------------------------------------------------
	// resize
	// -----------------------------------------------------------------------
	resize(sessionId: string, cols: number, rows: number): void {
		if (this.disposed) {
			return;
		}
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}
		this.shellEventLog?.log({
			source: "main",
			event: "terminal-resize",
			windowId: null,
			data: { terminalSessionId: sessionId, cols, rows },
		});
		session.pty.resize(cols, rows);
	}

	// -----------------------------------------------------------------------
	// stop
	// -----------------------------------------------------------------------
	stop(sessionId: string): void {
		if (this.disposed) {
			return;
		}
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}
		this.shellEventLog?.log({
			source: "main",
			event: "terminal-stop-request",
			windowId: null,
			reasonKind: "user_action",
			reason: "user_stop",
			data: { terminalSessionId: sessionId },
		});
		session.pty.kill();
		// Let the onExit handler handle state update, event emission, and cleanup
	}

	// -----------------------------------------------------------------------
	// dispose — tear down all sessions (for app quit)
	// -----------------------------------------------------------------------
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		const activeSessions = [...this.sessions.values()];
		this.sessions.clear();
		for (const session of activeSessions) {
			try {
				this.shellEventLog?.log({
					source: "main",
					event: "terminal-dispose",
					windowId: null,
					reasonKind: "backend_cleanup",
					reason: "service_dispose",
					isExpected: false,
					data: {
						terminalSessionId: session.meta.id,
						workspaceId: session.meta.workspaceId,
						worktreeId: session.meta.worktreeId,
					},
				});
				this.shellEventLog?.log({
					source: "main",
					event: "terminal-binding-changed",
					windowId: null,
					reasonKind: "backend_cleanup",
					reason: "service_dispose",
					isExpected: false,
					expectedBecause: null,
					data: {
						terminalSessionId: session.meta.id,
						workspaceId: session.meta.workspaceId,
						worktreeId: session.meta.worktreeId,
					},
				});
				session.pty.kill();
			} catch {
				// Best-effort cleanup; ignore errors on shutdown
			}
		}
		this.sessions.clear();
	}
}
