import type { WhisperWorktreeState } from "../../shared/models/ecosystem-plugin.js";
import type { PushWakeAuditEntry } from "../diagnostics/push-wake-audit-logger.js";
import {
	detectPushWakeEvents,
	type PushWakeSeenState,
} from "./push-wake-detector.js";
import type { PushWakeStateStore } from "./push-wake-state-store.js";
import type { PushSendOutcome } from "./push-wake-sender.js";

// Whisper-driver cadence (whisper-driver.ts:36); inside the spec's 2–5 s window.
export const PUSH_WAKE_POLL_INTERVAL_MS = 3000;

// Thin I/O shell around the pure detector (spec Deliverable 3). Ordering rule:
// persist BEFORE send — a crash in between loses a ping (pull covers it); the
// reverse order could re-ping a settled workflow, which is forbidden.
export function createPushWakeWatcher(deps: {
	getStates: () => Promise<WhisperWorktreeState[]>;
	stateStore: PushWakeStateStore;
	isEnabled: () => boolean;
	hasToken: () => boolean;
	send: () => Promise<PushSendOutcome>;
	audit: (entry: PushWakeAuditEntry) => void;
	now?: () => number;
	intervalMs?: number;
}): { start(): void; stop(): void; tick(): Promise<void> } {
	const now = deps.now ?? Date.now;
	const intervalMs = deps.intervalMs ?? PUSH_WAKE_POLL_INTERVAL_MS;
	let timer: ReturnType<typeof setInterval> | null = null;
	let ticking = false;
	let seen: PushWakeSeenState | null | undefined; // undefined = not loaded yet

	async function tick(): Promise<void> {
		if (ticking) return;
		ticking = true;
		try {
			if (!deps.isEnabled()) return;
			const states = await deps.getStates();
			// Empty read = schema gate closed / db busy / genuinely nothing.
			// Never advance or prune on it (mem-2026-07-03: blank ≠ vanished).
			if (states.length === 0) return;
			if (seen === undefined) seen = deps.stateStore.load();
			const { events, next } = detectPushWakeEvents(seen, states);
			deps.stateStore.save(next);
			seen = next;
			if (events.length === 0 || !deps.hasToken()) return;
			for (const event of events) {
				const outcome = await deps.send();
				if (outcome === "no-token") return; // raced deregister
				deps.audit({ ts: now(), trigger: event.trigger, outcome });
				if (outcome === "dead-token-cleared") return; // device gone
			}
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
