import { useEffect, useRef } from "react";
import { agentPtys } from "../../lib/desktop-client";
import type { WorkspaceState } from "../../features/workspace/logic/workspace-state";

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
 * Removal is NOT handled here: `handleCloseProcess` in use-process-actions.ts
 * calls `agentPtys.remove` directly at the point a process is closed, where
 * the worktreeId/processId are already in hand.
 */
export function useAgentPtyPublisher(workspaceState: WorkspaceState): void {
	const prevTuplesRef = useRef<Map<string, string>>(new Map());

	useEffect(() => {
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
			if (prevTuplesRef.current.get(process.id) === tuple) continue;
			prevTuplesRef.current.set(process.id, tuple);
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
		// Drop tuples for processes no longer present so the ref map doesn't
		// grow unbounded across a long session's worth of closed processes.
		for (const id of prevTuplesRef.current.keys()) {
			if (!seenIds.has(id)) prevTuplesRef.current.delete(id);
		}
	}, [workspaceState.processSessionsById]);
}
