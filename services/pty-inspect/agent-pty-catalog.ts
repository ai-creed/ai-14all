import type { PtyMirror } from "./pty-mirror.js";
import type { AgentProvider } from "../../shared/models/agent-attention.js";

export type AgentPtyUpsert = {
	worktreeId: string;
	agentId: string;
	terminalSessionId: string | null;
	provider: AgentProvider | null;
	label: string;
	live: boolean;
	agentDetected: boolean;
};

export type CatalogEvent = {
	kind: "exit-final-hint" | "disposed" | "rebound";
	worktreeId: string;
	agentId: string;
};

type MirrorSource = {
	getMirror(terminalSessionId: string): PtyMirror | undefined;
	takeMirror(terminalSessionId: string): PtyMirror | undefined;
};

type Entry = {
	worktreeId: string;
	agentId: string;
	terminalSessionId: string;
	provider: AgentProvider | null;
	label: string;
	live: boolean;
	mirror: PtyMirror;
	epochFloor: number;
	intent: {
		timer: ReturnType<typeof setTimeout>;
		deferredExit: boolean;
	} | null;
};

const DEFAULT_INTENT_TIMEOUT_MS = 10_000;

// Main-process authority for (worktreeId, agentId) → mirror. Spec §§1.1-1.3:
// sticky classification, terminal-ID-correlated exits, rebind intent.
export class AgentPtyCatalog {
	private readonly entries = new Map<string, Entry>();
	private readonly listeners: Array<(ev: CatalogEvent) => void> = [];
	private source: MirrorSource | null = null;
	private readonly intentTimeoutMs: number;

	constructor(opts?: { intentTimeoutMs?: number }) {
		this.intentTimeoutMs = opts?.intentTimeoutMs ?? DEFAULT_INTENT_TIMEOUT_MS;
	}

	attachMirrorSource(src: MirrorSource): void {
		this.source = src;
	}

	onEvent(cb: (ev: CatalogEvent) => void): void {
		this.listeners.push(cb);
	}

	private emit(ev: CatalogEvent): void {
		for (const cb of this.listeners) cb(ev);
	}

	private key(worktreeId: string, agentId: string): string {
		return `${worktreeId}\u0000${agentId}`;
	}

	upsert(msg: AgentPtyUpsert): void {
		const key = this.key(msg.worktreeId, msg.agentId);
		const existing = this.entries.get(key);
		if (!existing) {
			// Only ever admit agents; plain shells never enter the catalog.
			if (!msg.agentDetected || !msg.terminalSessionId) return;
			const mirror = this.source?.takeMirror(msg.terminalSessionId);
			if (!mirror) return;
			this.entries.set(key, {
				worktreeId: msg.worktreeId,
				agentId: msg.agentId,
				terminalSessionId: msg.terminalSessionId,
				provider: msg.provider,
				label: msg.label,
				live: msg.live,
				mirror,
				epochFloor: 0,
				intent: null,
			});
			return;
		}
		// Sticky classification: upserts update metadata, never demote.
		existing.label = msg.label;
		if (msg.provider) existing.provider = msg.provider;
		if (
			msg.terminalSessionId &&
			msg.terminalSessionId !== existing.terminalSessionId
		) {
			// Atomic rebind (spec §1.3): dispose old, adopt from-birth mirror,
			// continue the entry's epoch sequence strictly upward.
			const next = this.source?.takeMirror(msg.terminalSessionId);
			if (!next) return;
			existing.epochFloor = Math.max(
				existing.epochFloor,
				existing.mirror.epoch,
			);
			existing.mirror.dispose(); // also cancels its pending drain influence
			next.setEpochFloor(existing.epochFloor);
			existing.mirror = next;
			existing.terminalSessionId = msg.terminalSessionId;
			existing.live = true;
			this.resolveIntent(existing);
			this.emit({
				kind: "rebound",
				worktreeId: existing.worktreeId,
				agentId: existing.agentId,
			});
			return;
		}
		if (msg.live) existing.live = true;
	}

	remove(worktreeId: string, agentId: string): void {
		const key = this.key(worktreeId, agentId);
		const entry = this.entries.get(key);
		if (!entry) return;
		if (entry.intent) clearTimeout(entry.intent.timer);
		entry.mirror.dispose();
		this.entries.delete(key);
		this.emit({ kind: "disposed", worktreeId, agentId });
	}

	rebindIntent(worktreeId: string, agentId: string): void {
		const entry = this.entries.get(this.key(worktreeId, agentId));
		if (!entry) return;
		if (entry.intent) clearTimeout(entry.intent.timer);
		entry.intent = {
			deferredExit: false,
			timer: setTimeout(() => this.expireIntent(entry), this.intentTimeoutMs),
		};
	}

	rebindCancel(worktreeId: string, agentId: string): void {
		const entry = this.entries.get(this.key(worktreeId, agentId));
		if (entry) this.expireIntent(entry);
	}

	private expireIntent(entry: Entry): void {
		if (!entry.intent) return;
		clearTimeout(entry.intent.timer);
		const hadDeferredExit = entry.intent.deferredExit;
		entry.intent = null;
		if (hadDeferredExit) this.publishExit(entry);
	}

	private resolveIntent(entry: Entry): void {
		if (!entry.intent) return;
		clearTimeout(entry.intent.timer);
		entry.intent = null; // deferred exit belongs to the displaced terminal — dropped
	}

	// Terminal-ID-correlated, drain-ordered exit (spec §1.3 Retain).
	async handleTerminalExit(terminalSessionId: string): Promise<void> {
		const entry = [...this.entries.values()].find(
			(e) => e.terminalSessionId === terminalSessionId,
		);
		if (!entry) return; // stale exit for an already-rebound/removed terminal
		await entry.mirror.drained();
		if (entry.terminalSessionId !== terminalSessionId) return; // rebound mid-drain
		if (entry.intent) {
			entry.intent.deferredExit = true; // early ordering: suppress until bind/cancel/expiry
			return;
		}
		this.publishExit(entry);
	}

	private publishExit(entry: Entry): void {
		if (!entry.live) return;
		entry.live = false;
		this.emit({
			kind: "exit-final-hint",
			worktreeId: entry.worktreeId,
			agentId: entry.agentId,
		});
	}

	listPtys(worktreeId: string) {
		return [...this.entries.values()]
			.filter((e) => e.worktreeId === worktreeId)
			.map((e) => ({
				agentId: e.agentId,
				provider: e.provider,
				label: e.label,
				cols: e.mirror.cols,
				epoch: e.mirror.epoch,
				watermark: e.mirror.watermark,
				live: e.live,
			}));
	}

	getEntry(worktreeId: string, agentId: string) {
		const entry = this.entries.get(this.key(worktreeId, agentId));
		return entry ? { mirror: entry.mirror, live: entry.live } : undefined;
	}
}
