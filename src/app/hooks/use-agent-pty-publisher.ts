import { useEffect, useRef } from "react";
import { agentPtys } from "../../lib/desktop-client";
import type { WorkspaceState } from "../../features/workspace/logic/workspace-state";

type PublishedRecord = { workspaceId: string; worktreeId: string; tuple: string };

/**
 * Publishes every ProcessSession's (terminalSessionId, label, provider,
 * status, agentDetected) tuple to the main-process agent PTY catalog
 * whenever it changes, via `agentPtys.upsert` (the typed desktop-client
 * wrapper around `window.ai14all.agentPtys.upsert`).
 *
 * The previous-tuple ref map starts empty on every mount, so a renderer
 * reload republishes the full current set (spec §6.10) — there is no need
 * for a separate "initial sync" pass.
 *
 * Removal (spec §1.2 — the renderer's remove message is the catalog's ONLY
 * teardown signal): on every run, after publishing upserts, any previously
 * published process id that has disappeared from
 * `workspaceState.processSessionsById` is diffed out and published as an
 * `agentPtys.remove`. This is a catch-all for every path a process can
 * vanish by — not just the explicit close button, but also a worktree
 * closing (`workspace/reconcileWorktrees` drops that worktree's
 * ProcessSessions with no per-process action at all) or any future removal
 * path that does the same. `handleCloseProcess` in use-process-actions.ts
 * still fires its own explicit `agentPtys.remove` as a fast path — that
 * call is idempotent and simply races harmlessly with this one.
 *
 * Scoped to the active workspace: `workspaceState` is only ever the
 * currently ACTIVE workspace's state (see use-active-workspace.ts) — a
 * workspace switch swaps `processSessionsById` to a different workspace's
 * map entirely, NOT a signal that the previous workspace's processes were
 * closed (their terminals keep running in the main process regardless of
 * which workspace is in view). The published-record map is therefore keyed
 * by processId but each record remembers which workspaceId it was
 * published under, and the presence diff below only ever evicts records
 * whose workspaceId matches the workspace currently being diffed — records
 * belonging to another (currently inactive) workspace are left untouched
 * until that workspace is active again.
 */
export function useAgentPtyPublisher(
	workspaceState: WorkspaceState,
	workspaceId: string | null,
): void {
	const publishedRef = useRef<Map<string, PublishedRecord>>(new Map());

	useEffect(() => {
		if (!workspaceId) return;
		const processSessionsById = workspaceState.processSessionsById;
		const seenIds = new Set<string>();
		for (const process of Object.values(processSessionsById)) {
			seenIds.add(process.id);
			const tuple = JSON.stringify([
				process.terminalSessionId,
				process.label,
				process.provider,
				process.status,
				process.agentDetected,
			]);
			const prev = publishedRef.current.get(process.id);
			if (prev && prev.tuple === tuple) continue;
			publishedRef.current.set(process.id, {
				workspaceId,
				worktreeId: process.worktreeId,
				tuple,
			});
			agentPtys
				.upsert({
					worktreeId: process.worktreeId,
					agentId: process.id,
					terminalSessionId: process.terminalSessionId,
					provider: process.provider,
					label: process.label,
					live: process.status === "running",
					agentDetected: process.agentDetected,
				})
				.catch(() => {});
		}
		// Presence diff, scoped to this workspace (see doc comment above): a
		// previously published record for a DIFFERENT workspaceId is left
		// alone here — it is not "seen" in this workspace's processSessionsById
		// by definition, but that says nothing about whether it still exists.
		for (const [id, record] of publishedRef.current) {
			if (record.workspaceId !== workspaceId) continue;
			if (seenIds.has(id)) continue;
			publishedRef.current.delete(id);
			agentPtys.remove(record.worktreeId, id).catch(() => {});
		}
	}, [workspaceState.processSessionsById, workspaceId]);
}
