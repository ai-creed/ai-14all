import { useCallback, useEffect, useRef } from "react";

type Options = {
	startupMode: string;
	activeWorktreeId: string | null | undefined;
	activeSessionProcessCount: number;
	hasActiveSession: boolean;
	/**
	 * Tri-state agent-CLI detection:
	 * - `null`  → detection still pending; defer (don't create a shell yet, so we
	 *   never race a default shell in before we know whether agents exist).
	 * - `true`  → an agent CLI is detected; skip the auto default shell and leave
	 *   the first slot empty for the user to fill intentionally (an agent via the
	 *   launcher, or a plain shell via the slot's start-a-shell CTA).
	 * - `false` → no agent CLI; create the default shell as before.
	 */
	agentsAvailable: boolean | null;
	createDefaultShell: () => Promise<unknown>;
};

export type UseDefaultShellOnEmptyWorktree = {
	/** Forget every worktree's "ensured" mark — call when the workspace switches. */
	resetAll: () => void;
	/** Forget a single worktree id — call when that worktree is removed. */
	forgetWorktree: (worktreeId: string) => void;
};

/**
 * When a worktree gains focus and has no terminal sessions yet, create a
 * default ad-hoc shell exactly once per worktree id. The "ensured" set is
 * reset on failure so the next attempt can retry.
 *
 * Returns helpers so the host can invalidate the set on workspace switch
 * (resetAll) or worktree removal (forgetWorktree).
 */
export function useDefaultShellOnEmptyWorktree(
	options: Options,
): UseDefaultShellOnEmptyWorktree {
	const {
		startupMode,
		activeWorktreeId,
		activeSessionProcessCount,
		hasActiveSession,
		agentsAvailable,
		createDefaultShell,
	} = options;
	const ensuredRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (startupMode !== "ready") return;
		if (!activeWorktreeId || !hasActiveSession) return;
		if (activeSessionProcessCount > 0) return;
		// Detection still pending: defer rather than create a shell we might have
		// skipped. Neither branch marks the worktree ensured, so a later resolution
		// (or a flip back to no-agents) still gets its correct outcome.
		if (agentsAvailable === null) return;
		// Agents present: leave the slot empty for an intentional choice.
		if (agentsAvailable) return;
		if (ensuredRef.current.has(activeWorktreeId)) return;

		ensuredRef.current.add(activeWorktreeId);
		void createDefaultShell().catch(() => {
			ensuredRef.current.delete(activeWorktreeId);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- guarded one-time default shell creation per worktree
	}, [
		startupMode,
		activeWorktreeId,
		activeSessionProcessCount,
		agentsAvailable,
	]);

	const resetAll = useCallback(() => {
		ensuredRef.current.clear();
	}, []);

	const forgetWorktree = useCallback((worktreeId: string) => {
		ensuredRef.current.delete(worktreeId);
	}, []);

	return { resetAll, forgetWorktree };
}
