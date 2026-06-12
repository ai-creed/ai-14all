import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin.js";
import type { WhisperStoreReader } from "./whisper-store-reader.js";

export type WhisperCollabWatcher = {
	/** One full read of the DB joined to known worktrees. */
	snapshot(): Promise<WhisperWorktreeState[]>;
	onSnapshot(cb: (states: WhisperWorktreeState[]) => void): () => void;
	start(intervalMs: number): void;
	stop(): void;
};

export function createWhisperCollabWatcher(options: {
	reader: WhisperStoreReader;
	resolveWorktreeId: (workspaceRoot: string) => Promise<string | null>;
	now?: () => number;
	heartbeatStaleMs?: number;
}): WhisperCollabWatcher {
	const now = options.now ?? (() => Date.now());
	const staleMs = options.heartbeatStaleMs ?? 30_000;
	const listeners = new Set<(s: WhisperWorktreeState[]) => void>();
	let timer: ReturnType<typeof setInterval> | null = null;
	let ticking = false;

	async function snapshot(): Promise<WhisperWorktreeState[]> {
		const states: WhisperWorktreeState[] = [];
		for (const collab of options.reader.readCollabs()) {
			const worktreeId = await options.resolveWorktreeId(collab.workspaceRoot);
			if (worktreeId === null) continue;
			const daemon = options.reader.readDaemon(collab.collabId);
			const daemonAlive =
				daemon !== null && now() - Date.parse(daemon.lastHeartbeatAt) < staleMs;
			const workflow = options.reader.readActiveWorkflow(collab.collabId);
			// Handback history hangs off the current phase's relay chain. Capped at
			// the last 20 entries (readHandoffs returns ascending by created_at).
			const handoffs = workflow?.currentChainId
				? options.reader.readHandoffs(workflow.currentChainId).slice(-20)
				: [];
			states.push({
				worktreeId,
				collabId: collab.collabId,
				daemonAlive,
				liveFeed: "polling", // driver overwrites when a socket is attached
				bindings: options.reader.readBindings(collab.collabId),
				workflow,
				escalation: options.reader.readEscalatedChain(collab.collabId),
				handoffs,
			});
		}
		return states;
	}

	async function tick(): Promise<void> {
		if (ticking) return; // skip overlapping ticks on slow reads
		ticking = true;
		try {
			const states = await snapshot();
			for (const cb of listeners) cb(states);
		} finally {
			ticking = false;
		}
	}

	return {
		snapshot,
		onSnapshot(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		start(intervalMs) {
			if (timer !== null) return;
			timer = setInterval(() => void tick(), intervalMs);
			void tick();
		},
		stop() {
			if (timer !== null) clearInterval(timer);
			timer = null;
			listeners.clear();
		},
	};
}
