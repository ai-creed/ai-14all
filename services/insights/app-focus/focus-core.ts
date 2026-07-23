/**
 * Pure focus/idle/uptime span state machine (spec §4). Electron-free and
 * clock-free: the shell feeds it timestamped signals and it returns CLOSED span
 * records. It holds the open uptime interval, at most one open focused span,
 * and — nested inside it — at most one open engaged span.
 */

export type AppSpanKind = "app.focused" | "app.engaged" | "app.uptime";

export type AppSpanReason =
	| "poll"
	| "idle"
	| "blur"
	| "suspend"
	| "quit"
	| "disabled";

export interface AppSpan {
	kind: AppSpanKind;
	startMs: number;
	endMs: number;
	reason: AppSpanReason;
}

/** Idle at or beyond this means "disengaged" (spec §4). */
export const IDLE_THRESHOLD_MS = 60_000;

export interface FocusCore {
	/** Collector armed: opens the uptime interval. */
	start(nowMs: number): AppSpan[];
	focus(nowMs: number): AppSpan[];
	blur(nowMs: number): AppSpan[];
	idlePoll(nowMs: number, idleSeconds: number): AppSpan[];
	suspend(nowMs: number): AppSpan[];
	/** `focused` = whether the window holds focus at resume. */
	resume(nowMs: number, focused: boolean): AppSpan[];
	/** Disable: drop open engagement, finalize uptime (reason `disabled`). */
	stop(nowMs: number): AppSpan[];
	/** Graceful quit: close open focused span + uptime (reason `quit`). */
	flush(nowMs: number): AppSpan[];
}

// Clamp so a backward wall-clock jump can never yield a negative duration, then
// drop non-positive spans: a zero-length row carries no information (§4, §10).
function push(
	out: AppSpan[],
	kind: AppSpanKind,
	startMs: number,
	endMs: number,
	reason: AppSpanReason,
): void {
	const end = Math.max(startMs, endMs);
	if (end <= startMs) return;
	out.push({ kind, startMs, endMs: end, reason });
}

export function createFocusCore(): FocusCore {
	let uptimeStart: number | null = null;
	// Non-null ⇒ a focused span is open; the value is the start of the current
	// un-emitted focused segment.
	let focusedBoundary: number | null = null;
	// Non-null ⇒ engaged is open; the value is the last CONFIRMED input time, so
	// the next segment runs [engagedBoundary, lastInput].
	let engagedBoundary: number | null = null;

	// Engagement ends at the last observed input, so closing a focused span emits
	// nothing further for engaged — its segments were already emitted at polls.
	function closeFocused(
		out: AppSpan[],
		nowMs: number,
		reason: AppSpanReason,
	): void {
		if (focusedBoundary !== null)
			push(out, "app.focused", focusedBoundary, nowMs, reason);
		focusedBoundary = null;
		engagedBoundary = null;
	}

	function closeUptime(
		out: AppSpan[],
		nowMs: number,
		reason: AppSpanReason,
	): void {
		if (uptimeStart !== null)
			push(out, "app.uptime", uptimeStart, nowMs, reason);
		uptimeStart = null;
	}

	return {
		start(nowMs) {
			if (uptimeStart === null) uptimeStart = nowMs;
			return [];
		},

		focus(nowMs) {
			if (focusedBoundary !== null) return []; // already focused
			focusedBoundary = nowMs;
			// Focus IS an input (click / cmd-tab), so engagement starts here.
			engagedBoundary = nowMs;
			return [];
		},

		blur(nowMs) {
			const out: AppSpan[] = [];
			if (focusedBoundary === null) return out; // spurious blur
			closeFocused(out, nowMs, "blur");
			return out;
		},

		idlePoll(nowMs, idleSeconds) {
			const out: AppSpan[] = [];
			if (focusedBoundary === null) return out; // no poll while blurred
			// Focused counts foreground time right up to the poll instant.
			push(out, "app.focused", focusedBoundary, nowMs, "poll");
			focusedBoundary = nowMs;

			const idleMs = idleSeconds * 1000;
			const lastInput = nowMs - idleMs;
			if (idleMs < IDLE_THRESHOLD_MS) {
				if (engagedBoundary === null) {
					// Reopen after a threshold gap: this poll itself emits nothing.
					engagedBoundary = lastInput;
				} else if (lastInput > engagedBoundary) {
					push(out, "app.engaged", engagedBoundary, lastInput, "poll");
					engagedBoundary = lastInput;
				}
			} else if (engagedBoundary !== null) {
				if (lastInput > engagedBoundary)
					push(out, "app.engaged", engagedBoundary, lastInput, "idle");
				engagedBoundary = null;
			}
			return out;
		},

		suspend(nowMs) {
			const out: AppSpan[] = [];
			closeFocused(out, nowMs, "suspend");
			closeUptime(out, nowMs, "suspend");
			return out;
		},

		resume(nowMs, focused) {
			uptimeStart = nowMs;
			if (focused) {
				focusedBoundary = nowMs;
				// Resume is not an input: engaged opens on the next input-present poll.
				engagedBoundary = null;
			}
			return [];
		},

		stop(nowMs) {
			const out: AppSpan[] = [];
			// Disable drops open engagement WITHOUT emitting it (capture-time consent),
			// but finalizes the uptime interval that certifies the consent-on window.
			focusedBoundary = null;
			engagedBoundary = null;
			closeUptime(out, nowMs, "disabled");
			return out;
		},

		flush(nowMs) {
			const out: AppSpan[] = [];
			closeFocused(out, nowMs, "quit");
			closeUptime(out, nowMs, "quit");
			return out;
		},
	};
}
