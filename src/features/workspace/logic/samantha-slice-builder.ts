// src/features/workspace/logic/samantha-slice-builder.ts
import type {
	SamanthaSessionSlice,
	SamanthaSessionTransition,
	SamanthaWorktreeSlice,
} from "../../../../shared/contracts/plugins";
import type { AgentAttentionState } from "../../../../shared/models/agent-attention";
import type { ProcessSession } from "../../../../shared/models/process-session";
import type { WorktreeSession } from "../../../../shared/models/worktree-session";
import { resolveWorktreeObserveState } from "./resolve-worktree-observe-state";

export type SliceInputWorktree = {
	worktreeId: string;
	session: WorktreeSession;
	processSessionsById: Record<string, ProcessSession>;
};

type Tracked = {
	last: AgentAttentionState;
	ring: SamanthaSessionTransition[];
};

export function createSamanthaSliceBuilder(opts?: {
	now?: () => number;
	ringSize?: number;
}): {
	build(
		worktrees: SliceInputWorktree[],
		focusedWorktreeId: string | null,
		mode: "loading" | "prompt" | "ready",
	): SamanthaSessionSlice;
} {
	const now = opts?.now ?? Date.now;
	const ringSize = opts?.ringSize ?? 5;
	const tracked = new Map<string, Tracked>();

	return {
		build(worktrees, focusedWorktreeId, mode) {
			const seen = new Set<string>();
			const slices: SamanthaWorktreeSlice[] = worktrees.map((wt) => {
				seen.add(wt.worktreeId);
				const resolved = resolveWorktreeObserveState(
					wt.session,
					wt.processSessionsById,
				);
				const prior = tracked.get(wt.worktreeId);
				let ring = prior?.ring ?? [];
				if (prior && prior.last !== resolved.attention) {
					ring = [
						...ring,
						{
							at: now(),
							from: prior.last,
							to: resolved.attention,
							summary: resolved.summary,
							source: resolved.source,
						},
					].slice(-ringSize);
				}
				tracked.set(wt.worktreeId, { last: resolved.attention, ring });
				return {
					worktreeId: wt.worktreeId,
					provider: resolved.provider,
					attention: resolved.attention,
					summary: resolved.summary,
					task: wt.session.task ?? null,
					nextAction: resolved.nextAction,
					updatedAt: resolved.updatedAt,
					recent: ring,
					sessionId: wt.session.activeProcessSessionId ?? null,
				};
			});
			// Forget worktrees that closed so the ring map does not leak.
			for (const id of [...tracked.keys()])
				if (!seen.has(id)) tracked.delete(id);
			return { worktrees: slices, app: { focusedWorktreeId, mode } };
		},
	};
}
