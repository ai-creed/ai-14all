import { describe, expect, it } from "vitest";
import type { MainToWorker, UsageWorkerConfig } from "../../../services/usage/worker-protocol.js";

describe("worker-protocol", () => {
	it("config carries userDataDir + chipRange (no popoverScope)", () => {
		const cfg: UsageWorkerConfig = {
			home: "/home", userDataDir: "/data", launchMs: 0, known: [], activeWorktreeIds: [],
			chipRange: "week", includeUntracked: false, backfillBatchSize: 8,
		};
		expect(cfg.userDataDir).toBe("/data");
		expect(cfg.chipRange).toBe("week");
		expect("popoverScope" in cfg).toBe(false);
	});

	it("setChipRange replaces setRange; no setScope message exists", () => {
		const msg: MainToWorker = { kind: "setChipRange", chipRange: "month" };
		expect(msg.kind).toBe("setChipRange");
		// @ts-expect-error setRange is gone
		const bad: MainToWorker = { kind: "setRange", range: "week" };
		void bad;
	});
});
