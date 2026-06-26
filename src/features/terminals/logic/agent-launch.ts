import type {
	AgentCliProbes,
	WhisperWorktreeState,
} from "../../../../shared/models/ecosystem-plugin";
import {
	AGENT_PROVIDER_IDS,
	PROVIDER_LABEL,
	providerDef,
	type AgentProviderId,
} from "../../../../shared/models/agent-provider";

/** Stable left-to-right order of the launcher chips. */
export const PROVIDER_ORDER = AGENT_PROVIDER_IDS;
export type AgentProvider = AgentProviderId;

/** Display label per provider, shared by every launch surface. */
export { PROVIDER_LABEL };

/**
 * Generous window after which a stuck pending-mount self-clears, so the chips
 * never wedge into plain-spawn-only mode if the lens never advances (e.g. the
 * mount terminal was closed before the binding landed). Whisper's daemon
 * spin-up is sub-second; 60s sits comfortably above it.
 */
export const MOUNT_PENDING_TIMEOUT_MS = 60_000;

export type MountPendingState =
	| { kind: "idle" }
	| { kind: "pending"; startedAt: number; baselineBound: number };

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

export type LaunchDecision =
	| { kind: "mount"; command: string }
	| { kind: "vendor"; command: string }
	| { kind: "defer" };

/**
 * The single launch rule (spec §B). Capacity is accounted as
 * `committed = liveBound + mountInFlight + deferred` against the 2-agent cap:
 * an in-flight mount and the single deferral each reserve a slot. A launch that
 * cannot fit runs as the plain vendor binary; it is never deferred. The deferred
 * slot is FIFO (one entry) — see useDeferredMount.
 *
 * `boundCount` only counts toward "full" when the collab is live (`daemonAlive`).
 * A stopped/dead collab keeps stale `bound` bindings in the store, but those
 * occupy no real slots — mounting into one creates/recovers a fresh collab — so
 * a dead collab must never block a mount.
 */
export function decideLaunch(
	provider: AgentProvider,
	ctx: {
		whisperHealthy: boolean;
		boundCount: number;
		daemonAlive: boolean;
		mountInFlight: boolean;
		deferredOccupied: boolean;
	},
): LaunchDecision {
	const def = providerDef(provider);
	const vendor: LaunchDecision = { kind: "vendor", command: def.binary };
	if (!def.whisperCapable || !ctx.whisperHealthy) return vendor;
	const liveBound = ctx.daemonAlive ? ctx.boundCount : 0;
	// Branch 1: a slot is free now, no mount is settling, and no deferred mount is
	// pending → mount immediately. The `!deferredOccupied` guard closes the
	// sub-tick window where mountInFlight has cleared but the deferred mount
	// hasn't fired yet, which would otherwise allow a third agent to overbook.
	if (!ctx.mountInFlight && !ctx.deferredOccupied && liveBound < 2) {
		return { kind: "mount", command: `whisper collab mount ${provider}` };
	}
	// Branch 2: a mount is settling, nothing is queued, and the in-flight mount
	// plus this one still fit (i.e. the collab is empty) → defer.
	if (ctx.mountInFlight && !ctx.deferredOccupied && liveBound + 1 < 2) {
		return { kind: "defer" };
	}
	// Branch 3: no room → plain vendor binary.
	return vendor;
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
	// Only a live collab occupies slots; a stopped one (stale bindings, dead
	// daemon) reads as "no collab" so the pill prompts to mount, not "ready".
	const bound = state?.daemonAlive ? boundCount(state) : 0;
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
	};
}

/**
 * Clear the pending window once a NEW binding lands (the mount actually settled)
 * or the timeout elapses. It must NOT clear merely because the daemon came alive
 * — that heartbeat precedes the binding and would let a rapid second click slip
 * through before the slot is real.
 */
export function advanceMountPending(
	state: MountPendingState,
	whisperState: WhisperWorktreeState | undefined,
	now: number,
): MountPendingState {
	if (state.kind !== "pending") return state;
	if (boundCount(whisperState) > state.baselineBound) return { kind: "idle" };
	if (now - state.startedAt > MOUNT_PENDING_TIMEOUT_MS) return { kind: "idle" };
	return state;
}
