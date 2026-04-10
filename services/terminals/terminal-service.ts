import { randomUUID } from "node:crypto";
import pty from "node-pty";
import type { IPty } from "node-pty";
import type { TerminalSession } from "../../shared/models/terminal-session.js";

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
	private disposed = false;

	constructor(handlers: TerminalEventHandlers) {
		this.handlers = handlers;
	}

	// -----------------------------------------------------------------------
	// create
	// -----------------------------------------------------------------------
	create(workspaceId: string, worktreeId: string, cwd: string): TerminalSession {
		if (this.disposed) {
			throw new Error("Terminal service has been disposed");
		}

		const id = randomUUID();

		const shell = process.env.SHELL ?? "/bin/zsh";

		let p: IPty;
		try {
			p = pty.spawn(shell, ["-l"], {
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

		// Broadcast initial state
		if (!this.disposed) {
			this.handlers.onState(id, "running");
		}

		// Forward PTY output
		p.onData((data: string) => {
			if (this.disposed) return;
			this.handlers.onOutput(id, data);
		});

		// Handle PTY exit
		p.onExit(({ exitCode, signal }) => {
			if (this.disposed) return;
			const session = this.sessions.get(id);
			if (!session) return; // Already cleaned up (e.g. dispose() was called)
			session.meta.status = "exited";
			session.meta.exitCode = exitCode;
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
			throw new Error(`Terminal session not found: ${sessionId}`);
		}
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
				session.pty.kill();
			} catch {
				// Best-effort cleanup; ignore errors on shutdown
			}
		}
		this.sessions.clear();
	}
}
