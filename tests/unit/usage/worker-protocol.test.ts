import { describe, expect, it } from "vitest";
import type {
	WorkerToMain,
	MainToWorker,
	UsageWorkerConfig,
} from "../../../services/usage/worker-protocol.js";

describe("worker-protocol", () => {
	it("config carries userDataDir + chipRange (no popoverScope)", () => {
		const cfg: UsageWorkerConfig = {
			home: "/home",
			userDataDir: "/data",
			launchMs: 0,
			known: [],
			activeWorktreeIds: [],
			chipRange: "week",
			includeUntracked: false,
			backfillBatchSize: 8,
		};
		expect(cfg.userDataDir).toBe("/data");
		expect(cfg.chipRange).toBe("week");
		expect("popoverScope" in cfg).toBe(false);
	});

	// The readiness message is the host's re-fork budget signal. Its VALUE is
	// that it is distinct from `snapshot`/`rangeResult`: those are emitted
	// during the initial sweep and straight off the in-memory ledger, so keying
	// the budget on "any message" would let a worker that never persists re-arm
	// it on every attempt and re-fork without bound.
	it("WorkerToMain carries a payload-free `ready` distinct from snapshot/rangeResult", () => {
		const ready: WorkerToMain = { kind: "ready" };
		expect(ready.kind).toBe("ready");
		expect(Object.keys(ready)).toEqual(["kind"]);

		const kinds = new Set<WorkerToMain["kind"]>([
			"snapshot",
			"rangeResult",
			"ready",
		]);
		expect(kinds.size).toBe(3);

		// @ts-expect-error `ready` is payload-free: nothing rides along with it
		const bad: WorkerToMain = { kind: "ready", ok: true };
		void bad;
	});

	it("setChipRange replaces setRange; no setScope message exists", () => {
		const msg: MainToWorker = { kind: "setChipRange", chipRange: "month" };
		expect(msg.kind).toBe("setChipRange");
		// @ts-expect-error setRange is gone
		const bad: MainToWorker = { kind: "setRange", range: "week" };
		void bad;
	});
});
