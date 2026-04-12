import { useState, useEffect, useCallback, useRef } from "react";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type {
	TerminalOutputEvent,
	TerminalExitEvent,
	TerminalStateEvent,
	TerminalErrorEvent,
} from "../../../shared/contracts/events";
import { terminals } from "../../lib/desktop-client";
import { logRendererShellEvent } from "./shell-event-logger";

export type RuntimeListeners = {
	onOutput?: (event: TerminalOutputEvent) => void;
	onExit?: (event: TerminalExitEvent) => void;
	onState?: (event: TerminalStateEvent) => void;
	onError?: (event: TerminalErrorEvent) => void;
};

export type UseTerminalSessionResult = {
	sessions: TerminalSession[];
	createSession: (workspaceId: string, worktreeId: string, cwd: string) => Promise<TerminalSession>;
	stopSession: (sessionId: string) => Promise<void>;
	removeSession: (sessionId: string) => void;
	sendInput: (sessionId: string, data: string) => Promise<void>;
	adoptSession: (session: TerminalSession) => void;
};

/**
 * Manages a list of terminal sessions keyed by worktree.
 * Subscribes to output/exit/state/error events from the backend,
 * returning the latest session list with up-to-date statuses.
 */
export function useTerminalSession(
	listeners?: RuntimeListeners,
): UseTerminalSessionResult {
	const [sessions, setSessions] = useState<TerminalSession[]>([]);
	const listenersRef = useRef(listeners);
	listenersRef.current = listeners;

	useEffect(() => {
		const unsubOutput = terminals.onOutput((event) => {
			listenersRef.current?.onOutput?.(event);
		});

		const unsubState = terminals.onState((event) => {
			setSessions((prev) =>
				prev.map((s) =>
					s.id === event.sessionId ? { ...s, status: event.status } : s,
				),
			);
			listenersRef.current?.onState?.(event);
		});

		const unsubExit = terminals.onExit((event) => {
			setSessions((prev) =>
				prev.map((s) =>
					s.id === event.sessionId
						? { ...s, status: "exited", exitCode: event.exitCode }
						: s,
				),
			);
			listenersRef.current?.onExit?.(event);
		});

		const unsubError = terminals.onError((event) => {
			setSessions((prev) =>
				prev.map((s) =>
					s.id === event.sessionId ? { ...s, status: "error" } : s,
				),
			);
			listenersRef.current?.onError?.(event);
		});

		return () => {
			unsubOutput();
			unsubState();
			unsubExit();
			unsubError();
		};
	}, []);

	const sessionsRef = useRef<TerminalSession[]>([]);

	const createSession = useCallback(async (workspaceId: string, worktreeId: string, cwd: string) => {
		logRendererShellEvent({ event: "renderer-session-create-request", windowId: null, data: { workspaceId, worktreeId, cwd } }).catch(() => {});
		const session = await terminals.create(workspaceId, worktreeId, cwd);
		setSessions((prev) => {
			const next = [...prev, session];
			sessionsRef.current = next;
			return next;
		});
		logRendererShellEvent({ event: "renderer-session-create-success", windowId: null, data: { terminalSessionId: session.id, workspaceId, worktreeId, trackedRendererSessionIds: sessionsRef.current.map((s) => s.id) } }).catch(() => {});
		logRendererShellEvent({ event: "renderer-session-tracked", windowId: null, data: { terminalSessionId: session.id, trackedRendererSessionIds: sessionsRef.current.map((s) => s.id) } }).catch(() => {});
		return session;
	}, []);

	const stopSession = useCallback(async (sessionId: string) => {
		await terminals.stop(sessionId);
	}, []);

	const removeSession = useCallback((sessionId: string) => {
		setSessions((prev) => prev.filter((session) => session.id !== sessionId));
	}, []);

	const adoptSession = useCallback((session: TerminalSession) => {
		setSessions((prev) => {
			if (prev.some((existing) => existing.id === session.id)) return prev;
			const next = [...prev, session];
			sessionsRef.current = next;
			logRendererShellEvent({ event: "renderer-session-adopt", windowId: null, data: { terminalSessionId: session.id, trackedRendererSessionIds: next.map((s) => s.id) } }).catch(() => {});
			return next;
		});
	}, []);

	const sendInput = useCallback(async (sessionId: string, data: string) => {
		await terminals.sendInput(sessionId, data);
	}, []);

	return {
		sessions,
		createSession,
		stopSession,
		removeSession,
		sendInput,
		adoptSession,
	};
}
