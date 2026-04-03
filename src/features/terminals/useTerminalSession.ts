import { useState, useEffect, useCallback } from "react";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import { terminals } from "../../lib/desktop-client";

export type UseTerminalSessionResult = {
  sessions: TerminalSession[];
  createSession: (worktreeId: string, cwd: string) => Promise<void>;
  stopSession: (sessionId: string) => Promise<void>;
};

/**
 * Manages a list of terminal sessions keyed by worktree.
 * Subscribes to output/exit/state/error events from the backend,
 * returning the latest session list with up-to-date statuses.
 */
export function useTerminalSession(): UseTerminalSessionResult {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);

  useEffect(() => {
    const unsubState = terminals.onState((event) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === event.sessionId ? { ...s, status: event.status } : s,
        ),
      );
    });

    const unsubExit = terminals.onExit((event) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === event.sessionId
            ? { ...s, status: "exited", exitCode: event.exitCode }
            : s,
        ),
      );
    });

    const unsubError = terminals.onError((event) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === event.sessionId ? { ...s, status: "error" } : s,
        ),
      );
    });

    return () => {
      unsubState();
      unsubExit();
      unsubError();
    };
  }, []);

  const createSession = useCallback(
    async (worktreeId: string, cwd: string) => {
      const session = await terminals.create(worktreeId, cwd);
      setSessions((prev) => [...prev, session]);
    },
    [],
  );

  const stopSession = useCallback(async (sessionId: string) => {
    await terminals.stop(sessionId);
  }, []);

  return { sessions, createSession, stopSession };
}
