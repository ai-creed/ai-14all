import { describe, expect, it } from "vitest";
import type {
	MainToWorker,
	UsageWorkerConfig,
} from "../../../services/usage/worker-protocol.js";

describe("worker protocol shape", () => {
	it("config carries home + range and no path/budget fields", () => {
		const cfg: UsageWorkerConfig = {
			home: "/home/me",
			offsetCachePath: "/u/offsets.json",
			launchMs: 0,
			known: [],
			activeWorktreeIds: [],
			range: "week",
			includeUntracked: false,
			backfillBatchSize: 8,
		};
		// @ts-expect-error claudeRoot was removed from UsageWorkerConfig
		expect(cfg.claudeRoot).toBeUndefined();
		expect(cfg.home).toBe("/home/me");
	});

	it("supports a setRange message", () => {
		const msg: MainToWorker = { kind: "setRange", range: "month" };
		expect(msg.kind).toBe("setRange");
	});
});
