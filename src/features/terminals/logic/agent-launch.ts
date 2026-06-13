import type {
	AgentCliProbes,
	WhisperWorktreeState,
} from "../../../../shared/models/ecosystem-plugin";

/** Stable left-to-right order of the launcher chips. */
export const PROVIDER_ORDER = ["claude", "codex", "ezio"] as const;
export type AgentProvider = (typeof PROVIDER_ORDER)[number];

/**
 * Generous window after which a stuck pending-mount self-clears, so the chips
 * never wedge into plain-spawn-only mode if the lens never advances (e.g. the
 * mount terminal was closed before the binding landed). Whisper's daemon
 * spin-up is sub-second; 60s sits comfortably above it.
 */
export const MOUNT_PENDING_TIMEOUT_MS = 60_000;

export type MountPendingState =
	| { kind: "idle" }
	| {
			kind: "pending";
			startedAt: number;
			baselineBound: number;
			baselineDaemonAlive: boolean;
	  };

/** Number of agents currently bound in the worktree's lens snapshot. */
export function boundCount(state: WhisperWorktreeState | undefined): number {
	return (state?.bindings ?? []).filter((b) => b.bindingState === "bound")
		.length;
}

/** Providers whose CLI was found on PATH, in PROVIDER_ORDER. */
export function visibleProviders(
	probes: AgentCliProbes | null,
): AgentProvider[] {
	if (!probes) return [];
	return PROVIDER_ORDER.filter((p) => probes[p]?.kind === "found");
}

/**
 * The single launch rule (spec §4). A pending mount forces a plain spawn, so a
 * rapid second click never issues a second concurrent `whisper collab mount`.
 */
export function launchCommandFor(
	provider: AgentProvider,
	ctx: { whisperHealthy: boolean; boundCount: number; mountPending: boolean },
): string {
	const canMount =
		ctx.whisperHealthy && ctx.boundCount < 2 && !ctx.mountPending;
	return canMount ? `whisper collab mount ${provider}` : provider;
}

export type CollabStatus = {
	tone: "muted" | "amber" | "accent";
	label: string;
};

/** The aggregate collab pill (spec §3.4). Null when whisper is off/absent. */
export function collabStatus(
	state: WhisperWorktreeState | undefined,
	whisperHealthy: boolean,
): CollabStatus | null {
	if (!whisperHealthy) return null;
	const bound = boundCount(state);
	if (bound >= 2)
		return { tone: "accent", label: "collab · ready for workflows" };
	if (bound === 1)
		return { tone: "amber", label: "collab · 1 agent · need 1 more" };
	return { tone: "muted", label: "mount an agent to start a collab" };
}

/** Begin a pending-mount window when a mount-capable launch fires. */
export function beginMountPending(
	state: WhisperWorktreeState | undefined,
	now: number,
): MountPendingState {
	return {
		kind: "pending",
		startedAt: now,
		baselineBound: boundCount(state),
		baselineDaemonAlive: state?.daemonAlive ?? false,
	};
}

/**
 * Clear the pending window once the lens confirms the mount (a new binding
 * landed, or the daemon came alive for a collab-creating mount) or the timeout
 * elapsed. Mirrors the advanceStartCollab idiom this feature replaces.
 */
export function advanceMountPending(
	state: MountPendingState,
	whisperState: WhisperWorktreeState | undefined,
	now: number,
): MountPendingState {
	if (state.kind !== "pending") return state;
	const bound = boundCount(whisperState);
	const daemonAlive = whisperState?.daemonAlive ?? false;
	if (bound > state.baselineBound) return { kind: "idle" };
	if (!state.baselineDaemonAlive && daemonAlive) return { kind: "idle" };
	if (now - state.startedAt > MOUNT_PENDING_TIMEOUT_MS) return { kind: "idle" };
	return state;
}
