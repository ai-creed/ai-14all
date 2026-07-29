// Electron shell for the app-focus collector: wires real BrowserWindow focus /
// blur and powerMonitor idle+suspend/resume signals into the electron-free
// focus-core, and forwards every closed span to the host's outbox. Electron-only
// (BrowserWindow/powerMonitor), so it is NOT host-Node unit-tested — the span
// logic lives in focus-core (unit-tested) and this shell is covered by the e2e.
import { randomUUID } from "node:crypto";
import { powerMonitor, type BrowserWindow } from "electron";
import {
	createFocusCore,
	type AppSpan,
	type FocusCore,
} from "../../../services/insights/app-focus/focus-core.js";
import { spanToObservation } from "../../../services/insights/app-focus/span-observation.js";
import type { OutboxEvent } from "../../../services/insights/outbox.js";
import type { InsightsCollector } from "./insights-host.js";

/** Idle-poll cadence; also the focused/engaged segmentation boundary (spec §4). */
export const IDLE_POLL_MS = 15_000;

export interface AppFocusCollectorDeps {
	window: BrowserWindow;
	/** Deliver a closed span (the host applies capture-time consent + outbox). */
	emit: (span: AppSpan, appRunId: string) => void;
	now?: () => number;
	getIdleSeconds?: () => number;
	pollIntervalMs?: number;
}

export class AppFocusCollector implements InsightsCollector {
	/** Opaque per-launch id stamped on every span (spec §5). Content-free. */
	readonly appRunId = randomUUID();

	private core: FocusCore = createFocusCore();
	private timer: ReturnType<typeof setInterval> | null = null;
	private armed = false;

	private readonly onFocus = () => this.feed(this.core.focus(this.now()));
	private readonly onBlur = () => this.feed(this.core.blur(this.now()));
	private readonly onSuspend = () => this.feed(this.core.suspend(this.now()));
	private readonly onResume = () =>
		this.feed(this.core.resume(this.now(), this.isWindowFocused()));

	constructor(private readonly deps: AppFocusCollectorDeps) {}

	private now(): number {
		return (this.deps.now ?? Date.now)();
	}

	private idleSeconds(): number {
		return (
			this.deps.getIdleSeconds ?? (() => powerMonitor.getSystemIdleTime())
		)();
	}

	// BrowserWindow#isFocused() throws once the window is destroyed; treat a
	// destroyed window as "not focused" rather than letting the shell crash.
	private isWindowFocused(): boolean {
		return !this.deps.window.isDestroyed() && this.deps.window.isFocused();
	}

	private feed(spans: AppSpan[]): void {
		for (const span of spans) this.deps.emit(span, this.appRunId);
	}

	start(): void {
		if (this.armed) return;
		this.armed = true;
		this.core = createFocusCore();
		this.feed(this.core.start(this.now()));
		this.deps.window.on("focus", this.onFocus);
		this.deps.window.on("blur", this.onBlur);
		powerMonitor.on("suspend", this.onSuspend);
		powerMonitor.on("resume", this.onResume);
		this.timer = setInterval(
			() => this.feed(this.core.idlePoll(this.now(), this.idleSeconds())),
			this.deps.pollIntervalMs ?? IDLE_POLL_MS,
		);
		// The window may already hold focus when capture is enabled mid-session.
		if (this.isWindowFocused()) this.feed(this.core.focus(this.now()));
	}

	/** Disable/pause: drop open engagement, return the finalizing uptime span(s). */
	stop(): AppSpan[] {
		if (!this.armed) return [];
		this.armed = false;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.deps.window.off("focus", this.onFocus);
		this.deps.window.off("blur", this.onBlur);
		powerMonitor.off("suspend", this.onSuspend);
		powerMonitor.off("resume", this.onResume);
		return this.core.stop(this.now());
	}

	/** Graceful quit: close open spans and the uptime interval. */
	flush(): void {
		this.feed(this.core.flush(this.now()));
		// A quit can be CANCELLED (close-gate prevents default on unsaved buffers),
		// so leave the collector live: re-open the uptime interval, and the focused
		// span if the window still holds focus. Without this a cancelled quit
		// silently ends app.uptime capture for the rest of the session.
		if (this.armed) {
			this.core.start(this.now());
			if (this.isWindowFocused()) this.feed(this.core.focus(this.now()));
		}
	}

	/**
	 * E2E seam entry point (spec §4). Only reachable through the flag-gated IPC
	 * channel, which validates the signal name before calling this.
	 */
	signal(
		type: "focus" | "blur" | "idle" | "suspend" | "resume" | "flush",
		arg: { atMs?: number; idleSeconds?: number } = {},
	): void {
		const at = arg.atMs ?? this.now();
		switch (type) {
			case "focus":
				return this.feed(this.core.focus(at));
			case "blur":
				return this.feed(this.core.blur(at));
			case "idle":
				return this.feed(this.core.idlePoll(at, arg.idleSeconds ?? 0));
			case "suspend":
				return this.feed(this.core.suspend(at));
			case "resume":
				return this.feed(this.core.resume(at, this.isWindowFocused()));
			case "flush":
				return this.feed(this.core.flush(at));
		}
	}
}

/** Build the host's `emit` bridge: span → observation → outbox event. */
export function spanEmitter(
	produce: (event: OutboxEvent) => void,
): (span: AppSpan, appRunId: string) => void {
	return (span, appRunId) => {
		const observation = spanToObservation(span, appRunId);
		produce({ eventId: observation.eventId, observation });
	};
}
