import { createCoalescer } from "../xbp/coalescer.js";
import type { AgentPtyCatalog } from "./agent-pty-catalog.js";
import { serializePage, type PtyRowsPage } from "./pty-serializer.js";

export type PtyRefusal = {
	ok: false;
	code: "no-such-pty" | "no-live-agent" | "internal";
};
export type PtyLifecycleEvent = {
	op: "subscribe" | "unsubscribe" | "replace" | "teardown";
	cause?: string;
	worktreeId: string;
	agentId: string;
	rowsServed: number | null;
};

const TICK_MS = 200;

// One active subscription for the paired phone (spec §3). Hints are
// content-free and coalesced; refusals fire no events (house rule).
export class PtySubscriptionRegistry {
	private readonly catalog: AgentPtyCatalog;
	private readonly emitHint: (p: {
		worktreeId: string;
		agentId: string;
		epoch: number;
		watermark: number;
	}) => void;
	private readonly tickMs: number;
	private active: {
		worktreeId: string;
		agentId: string;
		rowsServed: number;
		interval: ReturnType<typeof setInterval>;
		offEpochHint: () => void;
		hint: ReturnType<typeof createCoalescer>;
	} | null = null;
	private served = 0;
	private readonly lifecycleListeners: Array<(ev: PtyLifecycleEvent) => void> =
		[];

	constructor(opts: {
		catalog: AgentPtyCatalog;
		emitHint: PtySubscriptionRegistry["emitHint"];
		tickMs?: number;
	}) {
		this.catalog = opts.catalog;
		this.emitHint = opts.emitHint;
		this.tickMs = opts.tickMs ?? TICK_MS;
		this.catalog.onEvent((ev) => {
			if (
				this.active &&
				ev.worktreeId === this.active.worktreeId &&
				ev.agentId === this.active.agentId
			) {
				if (ev.kind === "exit-final-hint") {
					this.hintNow(); // final hint (post-drain), then agent-exit teardown
					this.drop("teardown", "agent-exit");
				} else if (ev.kind === "disposed") {
					this.drop("teardown", "session-teardown");
				} else if (ev.kind === "rebound") {
					// Re-register the epoch listener on the replacement mirror,
					// then hint with the new (strictly greater) epoch.
					this.active.offEpochHint();
					const entry = this.catalog.getEntry(ev.worktreeId, ev.agentId);
					if (entry) {
						const { hint } = this.active;
						this.active.offEpochHint = entry.mirror.onEpochBump(() =>
							hint.trigger(),
						);
					}
					this.active.hint.trigger();
				}
			}
		});
	}

	onLifecycle(cb: (ev: PtyLifecycleEvent) => void): void {
		this.lifecycleListeners.push(cb);
	}
	private lifecycle(ev: PtyLifecycleEvent): void {
		for (const cb of this.lifecycleListeners) cb(ev);
	}

	rowsServedTotal(): number {
		return this.served;
	}

	private hintNow(): void {
		if (!this.active) return;
		const entry = this.catalog.getEntry(
			this.active.worktreeId,
			this.active.agentId,
		);
		if (!entry) return;
		this.emitHint({
			worktreeId: this.active.worktreeId,
			agentId: this.active.agentId,
			epoch: entry.mirror.epoch,
			watermark: entry.mirror.watermark,
		});
	}

	private drop(
		op: "unsubscribe" | "replace" | "teardown",
		cause?: string,
	): void {
		if (!this.active) return;
		clearInterval(this.active.interval);
		this.active.offEpochHint();
		this.active.hint.cancel();
		this.lifecycle({
			op,
			cause,
			worktreeId: this.active.worktreeId,
			agentId: this.active.agentId,
			rowsServed: this.active.rowsServed,
		});
		this.active = null;
	}

	subscribe(
		worktreeId: string,
		agentId: string,
	): { ok: true; cols: number; epoch: number; watermark: number } | PtyRefusal {
		const entry = this.catalog.getEntry(worktreeId, agentId);
		if (!entry) return { ok: false, code: "no-such-pty" };
		if (!entry.live) return { ok: false, code: "no-live-agent" };
		if (this.active) this.drop("replace");
		// EVERY hint funnels through one coalescer per subscription, so the §5
		// budget (≤1 hint per tick window, ≤5/sec at 200ms) holds no matter how
		// many ticks and epoch bumps coincide. hintNow() reads current mirror
		// state at fire time, so the surviving hint always carries the latest
		// epoch/watermark.
		const hint = createCoalescer(() => this.hintNow(), this.tickMs);
		const interval = setInterval(() => {
			const current = this.catalog.getEntry(worktreeId, agentId);
			if (!current) return;
			if (current.mirror.tick()) hint.trigger();
		}, this.tickMs);
		// Epoch-only changes (resize/alt-screen/RIS) produce no dirty write, so
		// the tick loop alone stays silent — spec §6.3 requires the hint, and
		// routing through the coalescer bounds a continuous-resize storm to the
		// same budget.
		const offEpochHint = entry.mirror.onEpochBump(() => hint.trigger());
		this.active = {
			worktreeId,
			agentId,
			rowsServed: 0,
			interval,
			offEpochHint,
			hint,
		};
		this.lifecycle({
			op: "subscribe",
			worktreeId,
			agentId,
			rowsServed: null,
		});
		return {
			ok: true,
			cols: entry.mirror.cols,
			epoch: entry.mirror.epoch,
			watermark: entry.mirror.watermark,
		};
	}

	unsubscribe(worktreeId: string, agentId: string): { ok: true } | PtyRefusal {
		if (
			!this.active ||
			this.active.worktreeId !== worktreeId ||
			this.active.agentId !== agentId
		) {
			return this.catalog.getEntry(worktreeId, agentId)
				? { ok: true } // idempotent
				: { ok: false, code: "no-such-pty" };
		}
		this.drop("unsubscribe");
		return { ok: true };
	}

	async pullRows(
		worktreeId: string,
		agentId: string,
		cursor: string | null,
	): Promise<({ ok: true } & PtyRowsPage) | PtyRefusal> {
		const entry = this.catalog.getEntry(worktreeId, agentId);
		if (!entry) return { ok: false, code: "no-such-pty" };
		try {
			await entry.mirror.settled(); // §2 barrier: never serialize mid-reset
			// Re-validate after the await: a rebind (disposes the old mirror,
			// swaps in a new one) or a remove can interleave while settled()
			// was pending. Serving off the stale `entry` here would tick/
			// serialize a disposed mirror (stale-epoch page, or a caught throw
			// masquerading as a spurious "internal" refusal).
			const current = this.catalog.getEntry(worktreeId, agentId);
			if (!current) return { ok: false, code: "no-such-pty" };
			current.mirror.tick(); // fold pending writes into stamps before serving
			const page = serializePage(current.mirror, { cursor });
			this.served += page.rows.length;
			if (
				this.active &&
				this.active.worktreeId === worktreeId &&
				this.active.agentId === agentId
			) {
				this.active.rowsServed += page.rows.length;
			}
			return { ok: true, ...page };
		} catch {
			return { ok: false, code: "internal" };
		}
	}

	teardown(cause: "peer-detach" | "re-pair" | "session-teardown"): void {
		this.drop("teardown", cause);
	}
}
