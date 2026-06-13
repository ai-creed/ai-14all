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
	launchCommandFor,
	MOUNT_PENDING_TIMEOUT_MS,
	visibleProviders,
} from "../../../src/features/terminals/logic/agent-launch";

const probes = (over: Partial<AgentCliProbes> = {}): AgentCliProbes => ({
	claude: { kind: "found", path: "/bin/claude", version: "1" },
	codex: { kind: "found", path: "/bin/codex", version: "1" },
	ezio: { kind: "not-found" },
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
		expect(visibleProviders(probes({ ezio: { kind: "found", path: "/bin/ezio", version: null } }))).toEqual([
			"claude",
			"codex",
			"ezio",
		]);
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

describe("launchCommandFor", () => {
	const base = { whisperHealthy: false, boundCount: 0, mountPending: false };
	it("whisper off → plain provider spawn", () => {
		expect(launchCommandFor("claude", base)).toBe("claude");
	});
	it("whisper unhealthy → plain provider spawn", () => {
		expect(
			launchCommandFor("codex", { ...base, whisperHealthy: false, boundCount: 0 }),
		).toBe("codex");
	});
	it("whisper healthy, no collab → mount (creates collab)", () => {
		expect(
			launchCommandFor("claude", { ...base, whisperHealthy: true, boundCount: 0 }),
		).toBe("whisper collab mount claude");
	});
	it("whisper healthy, 1 bound → mount (fills 2nd slot)", () => {
		expect(
			launchCommandFor("ezio", { ...base, whisperHealthy: true, boundCount: 1 }),
		).toBe("whisper collab mount ezio");
	});
	it("whisper healthy, 2 bound (full) → plain provider spawn", () => {
		expect(
			launchCommandFor("claude", { ...base, whisperHealthy: true, boundCount: 2 }),
		).toBe("claude");
	});
	it("mountPending → plain provider spawn (rapid-double-click guard)", () => {
		expect(
			launchCommandFor("claude", {
				whisperHealthy: true,
				boundCount: 0,
				mountPending: true,
			}),
		).toBe("claude");
	});
});

describe("collabStatus", () => {
	it("null when whisper not healthy", () => {
		expect(collabStatus(undefined, false)).toBeNull();
		expect(collabStatus(state({ bindings: bound("claude") }), false)).toBeNull();
	});
	it("muted when no collab yet (0 bound)", () => {
		expect(collabStatus(undefined, true)).toEqual({
			tone: "muted",
			label: "mount an agent to start a collab",
		});
	});
	it("amber at 1 bound", () => {
		expect(collabStatus(state({ bindings: bound("claude") }), true)).toEqual({
			tone: "amber",
			label: "collab · 1 agent · need 1 more",
		});
	});
	it("accent at 2 bound", () => {
		expect(
			collabStatus(state({ bindings: bound("claude", "ezio") }), true),
		).toEqual({ tone: "accent", label: "collab · ready for workflows" });
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
	it("begins pending capturing the bound + daemon baseline", () => {
		expect(beginMountPending(state({ daemonAlive: false }), 1000)).toEqual({
			kind: "pending",
			startedAt: 1000,
			baselineBound: 0,
			baselineDaemonAlive: false,
		});
	});
	it("clears once the daemon comes alive for a collab-creating mount", () => {
		const pending = beginMountPending(state({ daemonAlive: false }), 1000);
		expect(
			advanceMountPending(pending, state({ daemonAlive: true }), 1500),
		).toEqual({ kind: "idle" });
	});
	it("clears once a new binding lands", () => {
		const pending = beginMountPending(state({ bindings: bound("claude") }), 1000);
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
	it("stays pending for a second mount while the daemon was already alive (guards baselineDaemonAlive)", () => {
		// Second mount: the collab already exists (daemonAlive true at click time).
		// The guard must NOT clear merely because the daemon is alive — only a new
		// binding or the timeout may clear it. This locks in the baselineDaemonAlive
		// condition against a future "if (daemonAlive) return idle" simplification.
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
