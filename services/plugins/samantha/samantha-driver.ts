// services/plugins/samantha/samantha-driver.ts
import type {
	EcosystemPlugin,
	PluginContext,
} from "../plugin-registry";
import type {
	SamanthaHealth,
	SamanthaSessionSlice,
} from "../../../shared/contracts/plugins";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import { assembleObserve } from "./observe-assembler";
import { probeSamantha } from "./samantha-probe";
import type {
	SamanthaConnectorClient,
	SnapshotBody,
} from "./samantha-connector-client";
import type { SamanthaSignal, WorktreeIdentity } from "./observe-types";

export type SamanthaDriverOptions = {
	client: SamanthaConnectorClient;
	getIdentities: () => Promise<Record<string, WorktreeIdentity>>;
	getReviewCount: (worktreeId: string) => number;
	getWhisperStates: () => Promise<WhisperWorktreeState[]>;
	subscribeReviews: (cb: () => void) => () => void;
	subscribeWorktrees: (cb: () => void) => () => void;
	pushHealth: (h: SamanthaHealth) => void;
	now?: () => number;
	debounceMs?: number;
	keepAliveMs?: number;
	reconnectMs?: number;
};

const SPEECH_WORTHY = new Set<SamanthaSignal>([
	"attentionRequired",
	"error",
	"taskCompleted",
]);

const DESCRIPTION = "ai-14all coding sessions across your worktrees";

export function createSamanthaDriver(
	options: SamanthaDriverOptions,
): EcosystemPlugin & {
	ingestSessionSlice(slice: SamanthaSessionSlice): void;
} {
	const now = options.now ?? Date.now;
	const debounceMs = options.debounceMs ?? 1000;
	const keepAliveMs = options.keepAliveMs ?? 30000;
	const reconnectMs = options.reconnectMs ?? 3000;

	let stopped = true;
	let registered = false;
	let session: SamanthaSessionSlice | null = null;
	let lastBody: string | null = null;
	let lastSignals: Record<string, SamanthaSignal> = {};
	let pendingForce = false; // a keep-alive trigger forces a PATCH even if unchanged
	let inFlight = false; // a rebuild is currently running
	let rerun = false; // a trigger arrived mid-flight; coalesce into one more pass
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	const unsubscribers: (() => void)[] = [];

	function health(link: SamanthaHealth["link"]): void {
		options.pushHealth({ link });
	}

	function scheduleReconnect(): void {
		if (stopped || reconnectTimer !== null) return;
		health("reconnecting");
		// Route the retry through the scheduler so reconnect attempts serialize with
		// any in-flight rebuild and respect a pending force. rebuild() re-registers
		// itself at the top when !registered, so we don't ensureRegistered() here.
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			scheduleRebuild();
		}, reconnectMs);
	}

	async function ensureRegistered(): Promise<boolean> {
		if (stopped) return false;
		const r = await options.client.register({
			id: "ai-14all",
			label: "ai-14all",
			description: DESCRIPTION,
			capabilities: [],
		});
		// conflict => already registered; treat as success.
		if (r.ok || (!r.ok && r.reason === "conflict")) {
			registered = true;
			lastBody = null; // force a fresh full snapshot after (re)connect
			health("connected");
			return true;
		}
		registered = false;
		health(r.reason === "refused" ? "samantha-not-running" : "reconnecting");
		return false;
	}

	// Returns false ONLY when a PATCH could not be sent this cycle (so a forced
	// keep-alive obligation must be carried over); true on every other completion,
	// including event-POST bails where a PATCH already succeeded this cycle.
	async function rebuild(force = false): Promise<boolean> {
		if (stopped) return true;
		if (!registered) {
			const ok = await ensureRegistered();
			if (!ok) {
				scheduleReconnect();
				return false;
			}
		}
		// Review counts over ALL worktrees main owns (not just session ones), so
		// reviews show even before the renderer's first slice.
		const [identities, whisper] = await Promise.all([
			options.getIdentities(),
			options.getWhisperStates(),
		]);
		const reviewCounts: Record<string, number> = {};
		for (const id of Object.keys(identities))
			reviewCounts[id] = options.getReviewCount(id);

		const out = assembleObserve({ identities, reviewCounts, whisper, session });

		const body: SnapshotBody = {
			summary: out.summary,
			status: out.status,
			details: out.details,
			updatedAt: now(),
		};
		// Idempotent on CONTENT: skip a byte-identical body UNLESS this is a forced
		// (keep-alive) rebuild, which must refresh Samantha's freshness ~every 30s.
		const fingerprint = JSON.stringify({
			summary: body.summary,
			status: body.status,
			details: body.details,
		});
		if (force || fingerprint !== lastBody) {
			let r = await options.client.patchSnapshot(body);
			// Samantha restarted and dropped our registration: re-register, then
			// re-PATCH a fresh full snapshot BEFORE any event can be posted.
			if (!r.ok && r.reason === "not-found") {
				registered = false;
				if (await ensureRegistered()) {
					r = await options.client.patchSnapshot(body);
				}
			}
			if (!r.ok) {
				// PATCH still failing: reconnect and bail. Never POST an event
				// without a successful preceding PATCH. No PATCH landed this cycle,
				// so a forced keep-alive obligation must survive (return false).
				registered = false;
				scheduleReconnect();
				return false;
			}
			lastBody = fingerprint;
			health("connected");
		}

		// Events only for transitions INTO a speech-worthy signal. The PATCH above
		// has already refreshed Samantha's snapshot, so PATCH precedes every POST.
		for (const [worktreeId, signal] of Object.entries(out.signals)) {
			const prev = lastSignals[worktreeId];
			if (signal === prev || !SPEECH_WORTHY.has(signal)) continue;
			const wt = session?.worktrees.find((w) => w.worktreeId === worktreeId);
			const branch = identities[worktreeId]?.branch ?? worktreeId;
			// Build the summary from non-empty parts: a whisper-only worktree has no
			// session slice (wt undefined), so avoid a dangling "branch:  —".
			const summary = wt
				? `${branch}: ${[wt.attention, wt.summary]
						.filter((p) => p.length > 0)
						.join(" — ")}`.trim()
				: `${branch} (${signal})`;
			const r = await options.client.postEvent({
				signal,
				summary,
			});
			if (!r.ok) {
				// Samantha went away mid-cycle. Do NOT advance lastSignals, so this
				// transition is re-emitted once the link is restored. In both bails
				// below a PATCH already succeeded this cycle, so a forced keep-alive
				// obligation is already met (return true).
				registered = false;
				if (r.reason === "not-found") {
					// Restart: re-register AND immediately re-PATCH a fresh full
					// snapshot so Samantha is current before the retried event POST
					// (PATCH must precede POST). The scheduled rebuild re-emits it.
					if (await ensureRegistered()) {
						const re = await options.client.patchSnapshot(body);
						if (re.ok) {
							lastBody = fingerprint;
							health("connected");
						}
					}
					scheduleRebuild();
				} else {
					scheduleReconnect();
				}
				return true;
			}
		}
		lastSignals = out.signals;
		return true;
	}

	// Serialize rebuilds: only one runs at a time. A trigger that arrives while a
	// rebuild is in flight coalesces into exactly one more pass afterward.
	async function runRebuild(): Promise<void> {
		if (inFlight) {
			rerun = true;
			return;
		}
		inFlight = true;
		try {
			do {
				rerun = false;
				const force = pendingForce;
				pendingForce = false;
				let patched = false;
				try {
					patched = await rebuild(force);
				} catch {
					// A read tap (getIdentities/getWhisperStates) or client call threw: treat as a
					// failed transient cycle — never let it become an unhandled rejection in main
					// (graceful absence). The next scheduled/keep-alive rebuild retries.
					patched = false;
				}
				// A forced keep-alive PATCH that bailed before sending must survive
				// the bail, or the keep-alive is lost until the next ~30s tick.
				if (force && !patched) pendingForce = true;
			} while (rerun && !stopped);
		} finally {
			inFlight = false;
		}
	}

	function scheduleRebuild(force = false): void {
		if (stopped) return;
		if (force) pendingForce = true;
		if (debounceTimer !== null) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			void runRebuild();
		}, debounceMs);
	}

	return {
		id: "samantha",
		capabilities: [],
		probe: () => probeSamantha(),
		async start(_ctx: PluginContext) {
			stopped = false;
			registered = false;
			lastBody = null;
			lastSignals = {};
			pendingForce = false;
			health("connecting");
			unsubscribers.push(options.subscribeReviews(() => scheduleRebuild()));
			unsubscribers.push(options.subscribeWorktrees(() => scheduleRebuild()));
			// Keep-alive: force a PATCH ~every keepAliveMs even when content is
			// unchanged, so Samantha's stale-row freshness affordance stays current.
			keepAliveTimer = setInterval(() => scheduleRebuild(true), keepAliveMs);
			scheduleRebuild();
		},
		async stop() {
			stopped = true;
			if (debounceTimer !== null) clearTimeout(debounceTimer);
			if (keepAliveTimer !== null) clearInterval(keepAliveTimer);
			if (reconnectTimer !== null) clearTimeout(reconnectTimer);
			debounceTimer = keepAliveTimer = reconnectTimer = null;
			for (const u of unsubscribers.splice(0)) u();
			if (registered) await options.client.unregister();
			registered = false;
			health("samantha-not-running");
		},
		ingestSessionSlice(slice: SamanthaSessionSlice) {
			session = slice;
			scheduleRebuild();
		},
	};
}
