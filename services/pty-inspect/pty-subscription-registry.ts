import { createCoalescer } from "../xbp/coalescer.js";
import type { AgentPtyCatalog } from "./agent-pty-catalog.js";
import { serializePage, type PtyRowsPage } from "./pty-serializer.js";
import {
	TERMINAL_SPAWN_COLS,
	TERMINAL_SPAWN_ROWS,
} from "../../shared/constants/terminal-geometry.js";

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

// Structural (never `import type { TerminalService }`): the registry talks to
// whatever wires the real terminal only through this shape, late-attached via
// attachViewportHost. Keeps pty-inspect decoupled from the terminal module.
export type WatchViewportHost = {
	applyWatchResize(sessionId: string, cols: number, rows: number): void;
	restoreDesktopGeometry(sessionId: string): void;
	getDesktopGeometry(
		sessionId: string,
	): { cols: number; rows: number } | undefined;
	setPhoneOwned(sessionId: string, owned: boolean): void;
};
export type WatchStateEvent = {
	terminalSessionId: string;
	worktreeId: string;
	agentId: string;
	phoneOwned: boolean;
	cols: number | null; // clamped phone geometry while phone-owned, else null
	rows: number | null;
	provider: string | null;
	label: string | null;
	since: number; // epoch-ms of watch start
};

// Live state for the single in-flight watch (one phone, one narrowed PTY at
// a time — spec §2/§3). `owner` flips to "desktop" during a reclaim window
// (Task 5) without necessarily ending the watch outright.
type WatchState = {
	worktreeId: string;
	agentId: string;
	terminalSessionId: string;
	provider: string | null;
	label: string | null;
	preWatchGeometry: { cols: number; rows: number };
	owner: "phone" | "desktop";
	lastApplied: { cols: number; rows: number } | null;
	pending: { cols: number; rows: number } | null;
	debounce: ReturnType<typeof setTimeout> | null;
	grace: ReturnType<typeof setTimeout> | null;
	since: number;
	// Set by a desktop-keystroke reclaim (Task 5): the reclaim hands the PTY's
	// REAL geometry back to the desktop, so `lastApplied` — though still the
	// last value the PHONE asked for, kept around for notifyDesktopBlur's
	// direct re-apply — no longer describes what's actually on the terminal.
	// The next debounce-fire in setWatchViewport must re-apply even if the
	// phone re-asserts the identical geometry, bypassing the idempotence check
	// exactly once.
	forceReapply: boolean;
};

const TICK_MS = 200;
const WATCH_DEBOUNCE_MS = 150;
const RESTORE_GRACE_MS = 1000;

// Phone geometry never narrows a session below a usable minimum, regardless
// of how small the phone's own viewport gets (spec §2).
export const MIN_FLOOR_COLS = 40;
export const MIN_FLOOR_ROWS = 10;

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
	private readonly watchDebounceMs: number;
	private readonly restoreGraceMs: number;
	private readonly now: () => number;
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
	private viewportHost: WatchViewportHost | null = null;
	private watch: WatchState | null = null;
	private readonly watchStateListeners: Array<(ev: WatchStateEvent) => void> =
		[];
	// Last event actually delivered to watchStateListeners, so repeated
	// identical calls within a rotation burst don't spam the renderer (see
	// emitWatchOwned below).
	private lastEmitted: {
		phoneOwned: boolean;
		cols: number | null;
		rows: number | null;
	} = { phoneOwned: false, cols: null, rows: null };

	constructor(opts: {
		catalog: AgentPtyCatalog;
		emitHint: PtySubscriptionRegistry["emitHint"];
		tickMs?: number;
		watchDebounceMs?: number;
		restoreGraceMs?: number;
		now?: () => number;
	}) {
		this.catalog = opts.catalog;
		this.emitHint = opts.emitHint;
		this.tickMs = opts.tickMs ?? TICK_MS;
		this.watchDebounceMs = opts.watchDebounceMs ?? WATCH_DEBOUNCE_MS;
		this.restoreGraceMs = opts.restoreGraceMs ?? RESTORE_GRACE_MS;
		this.now = opts.now ?? Date.now;
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
			// Watch-scoped teardown/rebind — INDEPENDENT of `this.active`: a phone
			// can be watching an agent the desktop isn't (any longer) subscribed
			// to, and that watch must still end/rebind or the phoneOwned gate
			// sticks on a dead or replaced PTY forever (final-review finding).
			// executeWatchRestore is idempotent, so the double-call when `active`
			// ALSO matched above (already restored via drop()'s teardown path) is
			// safe.
			if (
				this.watch &&
				ev.worktreeId === this.watch.worktreeId &&
				ev.agentId === this.watch.agentId &&
				(ev.kind === "disposed" ||
					ev.kind === "exit-final-hint" ||
					ev.kind === "rebound")
			) {
				// disposed/exit-final-hint: the watched session is gone — restore
				// immediately. rebound: the watch still points at the OLD
				// terminalSessionId — restore (un-gating the old session) so the
				// phone's next set-watch-viewport re-resolves to the new one.
				this.executeWatchRestore();
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

	attachViewportHost(host: WatchViewportHost): void {
		this.viewportHost = host;
	}

	onWatchState(cb: (ev: WatchStateEvent) => void): void {
		this.watchStateListeners.push(cb);
	}
	private notifyWatchState(ev: WatchStateEvent): void {
		for (const cb of this.watchStateListeners) cb(ev);
	}

	// Pure transform: watch → wire event. Standalone from the emit/dedupe
	// policy so Task 5's getWatchState can reuse it for a point-in-time read
	// without going through setWatchViewport.
	private buildWatchOwnedEvent(watch: WatchState): WatchStateEvent {
		const geometry = watch.pending ?? watch.lastApplied;
		return {
			terminalSessionId: watch.terminalSessionId,
			worktreeId: watch.worktreeId,
			agentId: watch.agentId,
			phoneOwned: true,
			cols: geometry?.cols ?? null,
			rows: geometry?.rows ?? null,
			provider: watch.provider,
			label: watch.label,
			since: watch.since,
		};
	}

	// Emit policy: only when ownership or the applied/pending geometry
	// actually changed since the last delivered event — a rotation burst
	// coalesces to one resize (see setWatchViewport) and must not fan out
	// into a matching burst of renderer events. The re-assert path (owner
	// flips desktop→phone) always counts as an ownership change, so it emits
	// even when the geometry itself is unchanged.
	private emitWatchOwned(watch: WatchState): void {
		const ev = this.buildWatchOwnedEvent(watch);
		if (
			ev.phoneOwned === this.lastEmitted.phoneOwned &&
			ev.cols === this.lastEmitted.cols &&
			ev.rows === this.lastEmitted.rows
		) {
			return;
		}
		this.lastEmitted = {
			phoneOwned: ev.phoneOwned,
			cols: ev.cols,
			rows: ev.rows,
		};
		this.notifyWatchState(ev);
	}

	private emitWatchEnded(watch: WatchState): void {
		this.lastEmitted = { phoneOwned: false, cols: null, rows: null };
		this.notifyWatchState({
			terminalSessionId: watch.terminalSessionId,
			worktreeId: watch.worktreeId,
			agentId: watch.agentId,
			phoneOwned: false,
			cols: null,
			rows: null,
			provider: watch.provider,
			label: watch.label,
			since: watch.since,
		});
	}

	// Shared restore primitive (Tasks 4/5 build the grace-timer and
	// blur/reclaim policies on top of this). Always synchronous: cancels any
	// pending debounce/grace, clears watch state, and asks the host to put
	// the terminal back under desktop control before announcing the end.
	private executeWatchRestore(): void {
		const watch = this.watch;
		if (!watch) return;
		if (watch.debounce) clearTimeout(watch.debounce);
		if (watch.grace) clearTimeout(watch.grace);
		this.watch = null;
		// restoreDesktopGeometry also clears the phone-owned gate and re-applies
		// the desktop's CURRENT desired geometry (§3 — never the stale snapshot).
		this.viewportHost?.restoreDesktopGeometry(watch.terminalSessionId);
		this.emitWatchEnded(watch);
	}

	setWatchViewport(
		worktreeId: string,
		agentId: string,
		cols: number,
		rows: number,
	): { ok: true } | PtyRefusal {
		const entry = this.catalog.getEntry(worktreeId, agentId);
		if (!entry) return { ok: false, code: "no-such-pty" };
		const host = this.viewportHost;
		// Structurally unreachable in production (the host attaches during app
		// wiring, before the phone can call anything) — refuse rather than throw.
		// Checked before the live-agent business check: a mis-wired registry
		// (no host) is a more fundamental refusal than the target's liveness.
		if (!host) return { ok: false, code: "internal" };
		if (!entry.live) return { ok: false, code: "no-live-agent" };
		// Agent switch (umbrella §4 stop-A + start-B): a viewport for a different
		// agent than the one currently narrow restores the old PTY immediately.
		if (
			this.watch &&
			(this.watch.worktreeId !== worktreeId || this.watch.agentId !== agentId)
		) {
			this.executeWatchRestore();
		}
		if (!this.watch) {
			// First call: capture the desktop geometry BEFORE any narrow resize and
			// close the desktop auto-fit gate synchronously, so a fit racing this
			// call cannot fight the phone geometry.
			const pre = host.getDesktopGeometry(entry.terminalSessionId) ?? {
				cols: TERMINAL_SPAWN_COLS,
				rows: TERMINAL_SPAWN_ROWS,
			};
			this.watch = {
				worktreeId,
				agentId,
				terminalSessionId: entry.terminalSessionId,
				provider: entry.provider,
				label: entry.label,
				preWatchGeometry: pre,
				owner: "phone",
				lastApplied: null,
				pending: null,
				debounce: null,
				grace: null,
				since: this.now(),
				forceReapply: false,
			};
			host.setPhoneOwned(entry.terminalSessionId, true);
		}
		const watch = this.watch;
		// Re-watch within the restore grace cancels the pending restore (§3);
		// after a desktop keystroke reclaim, the phone re-asserting re-owns (§4).
		if (watch.grace) {
			clearTimeout(watch.grace);
			watch.grace = null;
		}
		if (watch.owner === "desktop") {
			watch.owner = "phone";
			host.setPhoneOwned(watch.terminalSessionId, true);
		}
		watch.pending = {
			cols: Math.min(
				Math.max(cols, MIN_FLOOR_COLS),
				watch.preWatchGeometry.cols,
			),
			rows: Math.min(
				Math.max(rows, MIN_FLOOR_ROWS),
				watch.preWatchGeometry.rows,
			),
		};
		// Trailing debounce: rotation bursts coalesce; only the latest geometry
		// is applied. Idempotence (same geometry re-sent) is checked at fire time.
		if (watch.debounce) clearTimeout(watch.debounce);
		watch.debounce = setTimeout(() => {
			watch.debounce = null;
			const target = watch.pending;
			watch.pending = null;
			if (!target || watch.owner !== "phone") return;
			// A pending reclaim forces exactly one re-apply through, even when the
			// target matches `lastApplied` byte-for-byte — see `forceReapply` above.
			const skip =
				!watch.forceReapply &&
				watch.lastApplied &&
				watch.lastApplied.cols === target.cols &&
				watch.lastApplied.rows === target.rows;
			watch.forceReapply = false;
			if (skip) return;
			host.applyWatchResize(watch.terminalSessionId, target.cols, target.rows);
			watch.lastApplied = target;
		}, this.watchDebounceMs);
		this.emitWatchOwned(watch);
		return { ok: true };
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

	// No-op if there's no watch or a grace is already pending (an earlier drop
	// or idempotent unsubscribe already scheduled one). Fires executeWatchRestore
	// after restoreGraceMs; a re-watch of the same agent within the window
	// clears `watch.grace` first (setWatchViewport, Task 3) and never reaches
	// here.
	private scheduleWatchGraceRestore(): void {
		if (!this.watch || this.watch.grace) return;
		this.watch.grace = setTimeout(() => {
			if (this.watch) this.watch.grace = null;
			this.executeWatchRestore();
		}, this.restoreGraceMs);
	}

	private drop(
		op: "unsubscribe" | "replace" | "teardown",
		cause?: string,
	): void {
		if (!this.active) return;
		clearInterval(this.active.interval);
		this.active.offEpochHint();
		this.active.hint.cancel();
		const endedWorktreeId = this.active.worktreeId;
		const endedAgentId = this.active.agentId;
		this.lifecycle({
			op,
			cause,
			worktreeId: endedWorktreeId,
			agentId: endedAgentId,
			rowsServed: this.active.rowsServed,
		});
		this.active = null;
		// Resize-on-watch §3: the end of the watched agent's subscription ends the
		// narrow viewport too. Graceful ends (unsubscribe/replace) get the ~1s
		// re-watch grace; teardown restores immediately — an explicit unsubscribe is
		// not guaranteed on app-kill / network-drop.
		if (
			this.watch &&
			this.watch.worktreeId === endedWorktreeId &&
			this.watch.agentId === endedAgentId
		) {
			if (op === "teardown") this.executeWatchRestore();
			else this.scheduleWatchGraceRestore();
		}
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
			if (!this.catalog.getEntry(worktreeId, agentId)) {
				// Entry gone means the session itself is gone (spec-final-review
				// finding): a grace here would be pointless — the phone's re-watch
				// would just refuse no-such-pty — so restore any matching lingering
				// watch IMMEDIATELY rather than leave the phoneOwned gate stuck.
				if (
					this.watch &&
					this.watch.worktreeId === worktreeId &&
					this.watch.agentId === agentId
				) {
					this.executeWatchRestore();
				}
				return { ok: false, code: "no-such-pty" };
			}
			// The phone's subscription for this agent was already replaced/torn
			// down (drop() has already run), but the watch survived on its grace —
			// a stop-watch arriving late for the same agent still needs to
			// (re-)schedule the restore rather than leave the phone owning it
			// forever.
			if (
				this.watch &&
				this.watch.worktreeId === worktreeId &&
				this.watch.agentId === agentId
			) {
				this.scheduleWatchGraceRestore();
			}
			return { ok: true }; // idempotent
		}
		this.drop("unsubscribe");
		return { ok: true };
	}

	async pullRows(
		worktreeId: string,
		agentId: string,
		cursor: string | null,
		opts?: { tail?: number; before?: string },
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
			const page = serializePage(current.mirror, {
				cursor,
				tail: opts?.tail,
				before: opts?.before,
			});
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

	/** Viewer policy (resize-on-watch §4): a real desktop keystroke routed to the
	 * phone-owned PTY restores desktop geometry immediately and marks it
	 * desktop-owned. The watch is RETAINED so the phone can re-assert
	 * (set-watch-viewport) or the desktop blur can hand ownership back. */
	notifyDesktopKeystroke(terminalSessionId: string): void {
		const watch = this.watch;
		if (!watch || watch.terminalSessionId !== terminalSessionId) return;
		if (watch.owner !== "phone") return;
		watch.owner = "desktop";
		if (watch.debounce) {
			clearTimeout(watch.debounce);
			watch.debounce = null;
			watch.pending = null;
		}
		// The reclaim hands the PTY's REAL geometry back to the desktop, so
		// `lastApplied` (kept around for notifyDesktopBlur's direct re-apply) no
		// longer describes what's actually on the terminal. forceReapply makes
		// the next setWatchViewport debounce-fire re-apply even if the phone
		// re-asserts the identical geometry, instead of matching the now-stale
		// value and skipping the re-narrow entirely.
		watch.forceReapply = true;
		this.viewportHost?.restoreDesktopGeometry(terminalSessionId);
		this.emitWatchEnded(watch); // phoneOwned: false — renderer unfreezes
	}

	/** §4 "until … the desktop blurs": after a reclaim, the desktop losing focus
	 * hands geometry back to a STILL-ACTIVE phone watch. */
	notifyDesktopBlur(terminalSessionId: string): void {
		const watch = this.watch;
		if (!watch || watch.terminalSessionId !== terminalSessionId) return;
		if (watch.owner !== "desktop") return;
		if (
			!this.active ||
			this.active.worktreeId !== watch.worktreeId ||
			this.active.agentId !== watch.agentId
		) {
			return; // phone is no longer watching — desktop keeps the geometry
		}
		watch.owner = "phone";
		this.viewportHost?.setPhoneOwned(terminalSessionId, true);
		if (watch.lastApplied) {
			// Direct re-apply of the last confirmed phone geometry — no phone
			// activity happened between the reclaim and this blur, so there's no
			// `pending` to debounce; this restores the terminal to where the phone
			// left it and also resyncs `lastApplied`, so forceReapply is spent.
			this.viewportHost?.applyWatchResize(
				terminalSessionId,
				watch.lastApplied.cols,
				watch.lastApplied.rows,
			);
			watch.forceReapply = false;
		}
		this.emitWatchOwned(watch);
	}

	/** §4 "the desktop blurs" at the OS/window level: cmd-tabbing away from the
	 * app (as opposed to an in-app element-level blur, see notifyDesktopBlur)
	 * must also hand a reclaimed watch back to the phone. Trivial delegation —
	 * notifyDesktopBlur already guards on the subscription still being active
	 * and on `owner === "desktop"`, so there is nothing to duplicate here. */
	notifyAppBlur(): void {
		const watch = this.watch;
		if (!watch || watch.owner !== "desktop") return;
		this.notifyDesktopBlur(watch.terminalSessionId);
	}

	getWatchState(terminalSessionId: string): WatchStateEvent | null {
		const watch = this.watch;
		if (!watch || watch.terminalSessionId !== terminalSessionId) return null;
		if (watch.owner !== "phone") return null;
		return this.buildWatchOwnedEvent(watch);
	}

	teardown(cause: "peer-detach" | "re-pair" | "session-teardown"): void {
		this.drop("teardown", cause);
		// Covers a lingering watch whose subscription was already gone (drop()
		// early-returns when `active` is null) — e.g. teardown fires after an
		// explicit unsubscribe already dropped the subscription but left the
		// watch on its grace. executeWatchRestore's `!watch` guard makes this
		// safe to call unconditionally, including the ordinary case where drop()
		// above already restored it.
		this.executeWatchRestore();
	}
}
