import { describe, expect, it } from "vitest";
import type {
	AgentCliProbes,
	WhisperWorktreeState,
} from "../../../shared/models/ecosystem-plugin";
import {
	advanceMountPending,
	beginMountPending,
	boundCount,
	collabStatus,
	decideLaunch,
	MOUNT_PENDING_TIMEOUT_MS,
	visibleProviders,
} from "../../../src/features/terminals/logic/agent-launch";

const probes = (over: Partial<AgentCliProbes> = {}): AgentCliProbes => ({
	claude: { kind: "found", path: "/bin/claude", version: "1" },
	codex: { kind: "found", path: "/bin/codex", version: "1" },
	ezio: { kind: "not-found" },
	cursor: { kind: "not-found" },
	antigravity: { kind: "not-found" },
	...over,
});

const state = (
	over: Partial<WhisperWorktreeState> = {},
): WhisperWorktreeState => ({
	worktreeId: "w1",
	collabId: "c1",
	daemonAlive: false,
	liveFeed: "polling",
	bindings: [],
	workflow: null,
	escalation: null,
	handoffs: [],
	...over,
});

const bound = (...agents: string[]) =>
	agents.map((agentType) => ({ agentType, bindingState: "bound" as const }));

describe("visibleProviders", () => {
	it("returns only found providers, in stable order", () => {
		expect(
			visibleProviders(
				probes({ ezio: { kind: "found", path: "/bin/ezio", version: null } }),
			),
		).toEqual(["claude", "codex", "ezio"]);
	});
	it("filters out not-found providers", () => {
		expect(visibleProviders(probes({ codex: { kind: "not-found" } }))).toEqual([
			"claude",
		]);
	});
	it("returns [] for null probes", () => {
		expect(visibleProviders(null)).toEqual([]);
	});
});

describe("decideLaunch", () => {
	const base = {
		whisperHealthy: true,
		boundCount: 0,
		daemonAlive: true,
		mountInFlight: false,
		deferredOccupied: false,
	};

	it("mounts immediately when a slot is free and nothing is settling", () => {
		expect(decideLaunch("claude", base)).toEqual({
			kind: "mount",
			command: "whisper collab mount claude",
		});
	});

	it("defers the 2nd click on an empty collab while the 1st mount settles", () => {
		expect(decideLaunch("codex", { ...base, mountInFlight: true })).toEqual({
			kind: "defer",
		});
	});

	it("does NOT defer when one agent is already bound and a mount is in flight (cap)", () => {
		expect(
			decideLaunch("codex", {
				...base,
				boundCount: 1,
				mountInFlight: true,
			}),
		).toEqual({ kind: "vendor", command: "codex" });
	});

	it("does NOT defer a second time once a deferral is queued (third → vendor)", () => {
		expect(
			decideLaunch("ezio", {
				...base,
				mountInFlight: true,
				deferredOccupied: true,
			}),
		).toEqual({ kind: "vendor", command: "ezio" });
	});

	it("vendors (not mount) when deferredOccupied is true even with a free slot (cap-belt guard)", () => {
		// Sub-tick window: mountInFlight just cleared but the deferred mount hasn't
		// fired yet. A click here must not overbook the 2-agent cap.
		expect(
			decideLaunch("claude", {
				...base,
				mountInFlight: false,
				deferredOccupied: true,
			}),
		).toEqual({ kind: "vendor", command: "claude" });
	});

	it("always vendors a non-whisper agent", () => {
		expect(decideLaunch("cursor", base)).toEqual({
			kind: "vendor",
			command: "agent",
		});
	});

	it("vendors antigravity (non-whisper) by its binary, never mounting", () => {
		expect(decideLaunch("antigravity", base)).toEqual({
			kind: "vendor",
			command: "agy",
		});
	});

	it("vendors a whisper-capable agent when whisper is unhealthy", () => {
		expect(decideLaunch("claude", { ...base, whisperHealthy: false })).toEqual({
			kind: "vendor",
			command: "claude",
		});
	});

	it("mounts into the 2nd slot of a live 1-bound collab", () => {
		expect(decideLaunch("ezio", { ...base, boundCount: 1 })).toEqual({
			kind: "mount",
			command: "whisper collab mount ezio",
		});
	});

	it("vendors when a live collab is already full (2 bound)", () => {
		expect(decideLaunch("claude", { ...base, boundCount: 2 })).toEqual({
			kind: "vendor",
			command: "claude",
		});
	});

	it("treats a STOPPED collab's stale bindings as empty → mount, not vendor", () => {
		// `whisper collab stop` leaves bindingState="bound" but the daemon is dead;
		// a dead collab occupies no real slots, so a mount must still be offered.
		expect(
			decideLaunch("claude", { ...base, boundCount: 2, daemonAlive: false }),
		).toEqual({ kind: "mount", command: "whisper collab mount claude" });
	});
});

describe("collabStatus", () => {
	it("null when whisper not healthy", () => {
		expect(collabStatus(undefined, false)).toBeNull();
		expect(
			collabStatus(state({ bindings: bound("claude") }), false),
		).toBeNull();
	});
	it("muted when no collab yet (0 bound)", () => {
		expect(collabStatus(undefined, true)).toEqual({
			tone: "muted",
			label: "mount an agent to start a collab",
		});
	});
	it("amber at 1 bound (live collab)", () => {
		expect(
			collabStatus(
				state({ daemonAlive: true, bindings: bound("claude") }),
				true,
			),
		).toEqual({
			tone: "amber",
			label: "collab · 1 agent · need 1 more",
		});
	});
	it("accent at 2 bound (live collab)", () => {
		expect(
			collabStatus(
				state({ daemonAlive: true, bindings: bound("claude", "ezio") }),
				true,
			),
		).toEqual({ tone: "accent", label: "collab · ready for workflows" });
	});
	it("muted for a STOPPED collab with stale bindings (daemonAlive false)", () => {
		// A dead collab is not "ready for workflows" — the pill must prompt to mount.
		expect(
			collabStatus(
				state({ daemonAlive: false, bindings: bound("claude", "codex") }),
				true,
			),
		).toEqual({ tone: "muted", label: "mount an agent to start a collab" });
	});
});

describe("boundCount", () => {
	it("counts only bound bindings; 0 for undefined", () => {
		expect(boundCount(undefined)).toBe(0);
		expect(
			boundCount(
				state({
					bindings: [
						{ agentType: "claude", bindingState: "bound" },
						{ agentType: "codex", bindingState: "pending_attach" },
					],
				}),
			),
		).toBe(1);
	});
});

describe("mount-pending state machine", () => {
	it("begins pending capturing the bound baseline", () => {
		expect(beginMountPending(state({ daemonAlive: false }), 1000)).toEqual({
			kind: "pending",
			startedAt: 1000,
			baselineBound: 0,
		});
	});
	it("stays pending when only the daemon comes alive (no binding yet)", () => {
		// The daemon heartbeat precedes the binding; clearing here would let a rapid
		// second click slip through before the slot is actually real.
		const pending = beginMountPending(state({ daemonAlive: false }), 1000);
		expect(
			advanceMountPending(pending, state({ daemonAlive: true }), 1500),
		).toEqual(pending);
	});
	it("clears once a new binding lands", () => {
		const pending = beginMountPending(
			state({ bindings: bound("claude") }),
			1000,
		);
		expect(
			advanceMountPending(
				pending,
				state({ bindings: bound("claude", "codex") }),
				1500,
			),
		).toEqual({ kind: "idle" });
	});
	it("stays pending while the lens has not advanced", () => {
		const pending = beginMountPending(state({ daemonAlive: false }), 1000);
		expect(
			advanceMountPending(pending, state({ daemonAlive: false }), 1500),
		).toEqual(pending);
	});
	it("stays pending for a second mount while the daemon was already alive", () => {
		// Second mount: the collab already exists (daemonAlive true at click time).
		// The guard must NOT clear merely because the daemon is alive — only a new
		// binding or the timeout may clear it.
		const pending = beginMountPending(
			state({ daemonAlive: true, bindings: bound("claude") }),
			1000,
		);
		expect(
			advanceMountPending(
				pending,
				state({ daemonAlive: true, bindings: bound("claude") }),
				1500,
			),
		).toEqual(pending);
	});
	it("stays pending exactly at the timeout boundary (strict greater-than)", () => {
		const pending = beginMountPending(state({ daemonAlive: false }), 1000);
		expect(
			advanceMountPending(
				pending,
				state({ daemonAlive: false }),
				1000 + MOUNT_PENDING_TIMEOUT_MS,
			),
		).toEqual(pending);
	});
	it("clears after the timeout even if the lens never advances", () => {
		const pending = beginMountPending(state({ daemonAlive: false }), 1000);
		expect(
			advanceMountPending(
				pending,
				state({ daemonAlive: false }),
				1000 + MOUNT_PENDING_TIMEOUT_MS + 1,
			),
		).toEqual({ kind: "idle" });
	});
	it("idle is stable", () => {
		expect(advanceMountPending({ kind: "idle" }, state(), 1)).toEqual({
			kind: "idle",
		});
	});
});
