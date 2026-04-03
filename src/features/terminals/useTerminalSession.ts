import { useState, useEffect, useCallback, useRef } from "react";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type {
	TerminalOutputEvent,
	TerminalExitEvent,
	TerminalStateEvent,
	TerminalErrorEvent,
} from "../../../shared/contracts/events";
import { terminals } from "../../lib/desktop-client";

export type RuntimeListeners = {
	onOutput?: (event: TerminalOutputEvent) => void;
	onExit?: (event: TerminalExitEvent) => void;
	onState?: (event: TerminalStateEvent) => void;
	onError?: (event: TerminalErrorEvent) => void;
};

export type UseTerminalSessionResult = {
	sessions: TerminalSession[];
	createSession: (worktreeId: string, cwd: string) => Promise<TerminalSession>;
	stopSession: (sessionId: string) => Promise<void>;
	removeSession: (sessionId: string) => void;
	sendInput: (sessionId: string, data: string) => Promise<void>;
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

	const createSession = useCallback(async (worktreeId: string, cwd: string) => {
		const session = await terminals.create(worktreeId, cwd);
		setSessions((prev) => [...prev, session]);
		return session;
	}, []);

	const stopSession = useCallback(async (sessionId: string) => {
		await terminals.stop(sessionId);
	}, []);

	const removeSession = useCallback((sessionId: string) => {
		setSessions((prev) => prev.filter((session) => session.id !== sessionId));
	}, []);

	const sendInput = useCallback(async (sessionId: string, data: string) => {
		await terminals.sendInput(sessionId, data);
	}, []);

	return { sessions, createSession, stopSession, removeSession, sendInput };
}
