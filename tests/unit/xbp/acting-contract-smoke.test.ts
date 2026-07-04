import { describe, it, expect } from "vitest";
import {
	CONTROL_ACT,
	COMMAND_CONTRACT_VERSION,
	LifecycleResult,
	pauseSessionCapability,
	resumeSessionCapability,
	stopSessionCapability,
} from "@ai-creed/command-contract";

describe("acting contract surface (0.1.0-alpha.1)", () => {
	it("exposes the lifecycle capabilities under control:act", () => {
		expect(CONTROL_ACT).toBe("control:act");
		expect(COMMAND_CONTRACT_VERSION).toBe(2);
		expect(pauseSessionCapability.id).toBe("xavier.control.pause-session");
		expect(resumeSessionCapability.id).toBe("xavier.control.resume-session");
		expect(stopSessionCapability.id).toBe("xavier.control.stop-session");
		for (const cap of [
			pauseSessionCapability,
			resumeSessionCapability,
			stopSessionCapability,
		]) {
			expect(cap.permission).toBe(CONTROL_ACT);
			expect(cap.args.safeParse({ worktreeId: "wt-1" }).success).toBe(true);
			expect(cap.args.safeParse({}).success).toBe(false);
		}
		expect(pauseSessionCapability.risk).toBe("low");
		expect(stopSessionCapability.risk).toBe("medium");
	});

	it("LifecycleResult parses success and every refusal code", () => {
		expect(
			LifecycleResult.safeParse({
				ok: true,
				worktreeId: "wt-1",
				workflowId: "wf-1",
				state: "paused",
				appliedAt: "2026-07-02T00:00:00.000Z",
			}).success,
		).toBe(true);
		for (const code of [
			"acting-disabled",
			"no-live-agent",
			"unknown-worktree",
			"ambiguous-worktree",
			"internal",
		]) {
			expect(LifecycleResult.safeParse({ ok: false, code }).success).toBe(true);
		}
		expect(LifecycleResult.safeParse({ worktreeId: "x" }).success).toBe(false);
	});
});
