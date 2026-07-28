import type { WhisperWorktreeState } from "../../shared/models/ecosystem-plugin.js";
import type { PushWakeAuditEntry } from "../diagnostics/push-wake-audit-logger.js";
import { detectPushWakeEvents } from "./push-wake-detector.js";
import { detectAttentionEvents } from "./push-wake-attention-detector.js";
import type {
	PushWakeStateStore,
	PushWakeWatcherStateV2,
} from "./push-wake-state-store.js";
import type { PushSendOutcome } from "./push-wake-sender.js";

// Whisper-driver cadence (whisper-driver.ts:36); inside the spec's 2–5 s window.
export const PUSH_WAKE_POLL_INTERVAL_MS = 3000;
// Global coalesce (child spec §3 gate 3): one ping attempt per window,
// counted from the last ATTEMPT (outcome-independent), persisted pre-send.
export const PUSH_WAKE_COALESCE_MS = 60_000;

// One watcher, both detectors, gates in order: enabled → suppressed →
// coalesced → no-token → persist → send (child spec §3). Persist BEFORE
// send: a crash between loses a ping (pull covers it); the reverse could
// re-ping a settled session, which is forbidden. Skip paths CONSUME
// transitions (state persisted) except persist-failed, which self-heals by
// retrying the same transitions next tick.
export function createPushWakeWatcher(deps: {
	getStates: () => Promise<WhisperWorktreeState[]> | WhisperWorktreeState[];
	getSessionReport: () => Promise<{
		sessions: ReadonlyArray<{ worktreeId: string; attention: string }>;
	}>;
	stateStore: PushWakeStateStore;
	isEnabled: () => boolean;
	hasToken: () => boolean;
	hasLivePhoneConnection: () => boolean;
	send: () => Promise<PushSendOutcome>;
	audit: (entry: PushWakeAuditEntry) => void;
	now?: () => number;
	intervalMs?: number;
}): { start(): void; stop(): void; tick(): Promise<void> } {
	const now = deps.now ?? Date.now;
	const intervalMs = deps.intervalMs ?? PUSH_WAKE_POLL_INTERVAL_MS;
	let timer: ReturnType<typeof setInterval> | null = null;
	let ticking = false;
	let state: PushWakeWatcherStateV2 | null | undefined; // undefined = not loaded
	let persistFailStreakAudited = false;

	async function tick(): Promise<void> {
		if (ticking) return;
		ticking = true;
		try {
			if (!deps.isEnabled()) return;
			if (state === undefined) state = deps.stateStore.load();

			// Whisper pass. Empty read = schema gate closed / db busy /
			// genuinely nothing — ambiguous, so skip the pass: no advance, no
			// prune, namespace rides through verbatim (mem-2026-07-03).
			const whisperSeen = state?.whisper ?? null;
			const states = await deps.getStates();
			const whisperPass =
				states.length > 0
					? detectPushWakeEvents(whisperSeen, states)
					: { events: [], next: whisperSeen };

			// Attention pass. Rejection = unavailable → skip the pass, state
			// untouched. A RESOLVED report is authoritative, even when empty
			// (prunes everything); it also counts as the first successful pass
			// that establishes a null namespace (baseline: record, no fire).
			const attentionSeen = state?.attention ?? null;
			let attentionPass: {
				events: ReturnType<typeof detectAttentionEvents>["events"];
				next: typeof attentionSeen;
			};
			try {
				const report = await deps.getSessionReport();
				attentionPass = detectAttentionEvents(attentionSeen, report.sessions);
			} catch {
				attentionPass = { events: [], next: attentionSeen };
			}

			const whisperEvents = whisperPass.events;
			const attentionEvents = attentionPass.events;
			const eventCount = whisperEvents.length + attentionEvents.length;

			if (eventCount === 0) {
				// Eventless ticks (baselines, re-arms, prunes) must persist
				// too — Arc B's restart continuity depends on it: a `running`
				// baseline followed by shutdown must reload as `running` so
				// the first post-restart `done` snapshot FIRES instead of
				// silently re-baselining. Dirty-check to avoid a disk write
				// every 3s when nothing moved. A failed eventless save does
				// not advance in memory (retry next tick) and does not audit
				// (§4: eventless ticks are silent).
				const idle: PushWakeWatcherStateV2 = {
					version: 2,
					whisper: whisperPass.next,
					attention: attentionPass.next,
					lastPingAt: state?.lastPingAt ?? null,
				};
				if (JSON.stringify(idle) === JSON.stringify(state)) {
					state = idle;
					return;
				}
				if (deps.stateStore.save(idle)) {
					persistFailStreakAudited = false;
					state = idle;
				}
				return;
			}

			const detectors: Array<"whisper" | "attention"> = [];
			if (whisperEvents.length > 0) detectors.push("whisper");
			if (attentionEvents.length > 0) detectors.push("attention");
			const trigger = whisperEvents[0]?.trigger ?? attentionEvents[0]!.trigger;

			// Gates 2–3 + no-token precheck decide the outcome; every eventful
			// tick persists (consuming the transitions) except persist-failed.
			const lastPingAt = state?.lastPingAt ?? null;
			let outcome:
				| "suppressed-connected"
				| "coalesced"
				| "no-token"
				| "attempt";
			if (deps.hasLivePhoneConnection()) outcome = "suppressed-connected";
			else if (
				lastPingAt !== null &&
				now() - lastPingAt < PUSH_WAKE_COALESCE_MS
			)
				outcome = "coalesced";
			else if (!deps.hasToken()) outcome = "no-token";
			else outcome = "attempt";

			const candidate: PushWakeWatcherStateV2 = {
				version: 2,
				whisper: whisperPass.next,
				attention: attentionPass.next,
				// lastPingAt records ATTEMPTS only: suppressed / coalesced /
				// prechecked no-token must not mint a coalesce window.
				lastPingAt: outcome === "attempt" ? now() : lastPingAt,
			};
			if (!deps.stateStore.save(candidate)) {
				// Fail-quiet (§2): no send, no in-memory advance — next tick
				// re-detects and retries. Audit once per failure streak.
				if (!persistFailStreakAudited) {
					deps.audit({
						ts: now(),
						trigger,
						outcome: "persist-failed",
						detectors,
					});
					persistFailStreakAudited = true;
				}
				return;
			}
			persistFailStreakAudited = false;
			state = candidate;

			if (outcome !== "attempt") {
				deps.audit({ ts: now(), trigger, outcome, detectors });
				return;
			}
			const sendOutcome = await deps.send();
			deps.audit({ ts: now(), trigger, outcome: sendOutcome, detectors });
		} catch (e) {
			// Best-effort: never let a tick failure escape as an unhandled
			// rejection (setInterval callers use `void tick()`). Log and
			// self-heal on the next tick.
			console.warn("[push-wake] tick failed:", e);
			return;
		} finally {
			ticking = false;
		}
	}

	return {
		tick,
		start() {
			if (timer !== null) return;
			timer = setInterval(() => void tick(), intervalMs);
			void tick();
		},
		stop() {
			if (timer !== null) clearInterval(timer);
			timer = null;
		},
	};
}
