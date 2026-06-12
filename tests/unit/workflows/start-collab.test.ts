import { describe, expect, it } from "vitest";
import {
	advanceStartCollab,
	START_COLLAB_TIMEOUT_MS,
	type StartCollabPhase,
} from "../../../src/features/workflows/logic/start-collab";

const bound = (...agents: string[]) =>
	agents.map((agentType) => ({ agentType, bindingState: "bound" as const }));

describe("advanceStartCollab", () => {
	const started: StartCollabPhase = { kind: "waiting", startedAt: 1000 };

	it("stays waiting while fewer than two target agents are bound", () => {
		expect(advanceStartCollab(started, bound("claude"), 2000)).toEqual(started);
	});

	it("flips to ready when both mounts are bound", () => {
		expect(advanceStartCollab(started, bound("claude", "codex"), 2000)).toEqual(
			{ kind: "ready" },
		);
	});

	it("ezio standing in for codex also counts", () => {
		expect(advanceStartCollab(started, bound("claude", "ezio"), 2000)).toEqual({
			kind: "ready",
		});
	});

	it("times out after the claim-expiry window", () => {
		expect(
			advanceStartCollab(started, [], 1000 + START_COLLAB_TIMEOUT_MS + 1),
		).toEqual({ kind: "timed-out" });
	});

	it("idle and terminal phases are stable", () => {
		expect(advanceStartCollab({ kind: "idle" }, bound("claude"), 99)).toEqual({
			kind: "idle",
		});
		expect(advanceStartCollab({ kind: "ready" }, [], 99)).toEqual({
			kind: "ready",
		});
	});
});
