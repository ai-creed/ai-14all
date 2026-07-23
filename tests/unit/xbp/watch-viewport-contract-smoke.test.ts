import { describe, it, expect } from "vitest";
import {
	CONTROL_INSPECT,
	COMMAND_CONTRACT_VERSION,
	SetWatchViewportArgs,
	SetWatchViewportResult,
	setWatchViewportCapability,
} from "@ai-creed/command-contract";

describe("set-watch-viewport contract surface (0.1.0-alpha.6 / v7)", () => {
	it("exposes the capability under control:inspect at v7", () => {
		expect(COMMAND_CONTRACT_VERSION).toBe(8);
		expect(setWatchViewportCapability.id).toBe(
			"xavier.control.set-watch-viewport",
		);
		expect(setWatchViewportCapability.permission).toBe(CONTROL_INSPECT);
		expect(setWatchViewportCapability.risk).toBe("low");
		expect(setWatchViewportCapability.requiresConfirmation).toBe(false);
	});

	it("validates args and the ok/refusal result union", () => {
		expect(
			SetWatchViewportArgs.safeParse({
				worktreeId: "wt-1",
				agentId: "proc-1",
				cols: 46,
				rows: 58,
			}).success,
		).toBe(true);
		expect(
			SetWatchViewportArgs.safeParse({
				worktreeId: "wt-1",
				agentId: "proc-1",
				cols: 0,
				rows: 58,
			}).success,
		).toBe(false);
		expect(SetWatchViewportResult.safeParse({ ok: true }).success).toBe(true);
		expect(
			SetWatchViewportResult.safeParse({ ok: false, code: "no-such-pty" })
				.success,
		).toBe(true);
		expect(
			SetWatchViewportResult.safeParse({ ok: false, code: "bogus" }).success,
		).toBe(false);
	});
});
