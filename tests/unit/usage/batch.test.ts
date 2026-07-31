import { describe, expect, it } from "vitest";
import { processInBatches } from "../../../services/usage/batch.js";

describe("processInBatches", () => {
	it("processes every item in order", async () => {
		const seen: number[] = [];
		await processInBatches([1, 2, 3, 4, 5], 2, (n) => seen.push(n));
		expect(seen).toEqual([1, 2, 3, 4, 5]);
	});
	it("invokes onBatch once per batch", async () => {
		let batches = 0;
		await processInBatches(
			[1, 2, 3, 4, 5],
			2,
			() => {},
			() => batches++,
		);
		expect(batches).toBe(3); // ceil(5/2)
	});
	it("yields to the event loop between batches (non-blocking)", async () => {
		let timerRan = false;
		setTimeout(() => {
			timerRan = true;
		}, 0);
		await processInBatches(
			Array.from({ length: 200 }, (_, i) => i),
			1,
			() => {},
		);
		expect(timerRan).toBe(true);
	});
	it("resolves immediately for an empty list", async () => {
		await expect(processInBatches([], 4, () => {})).resolves.toBeUndefined();
	});
});

// Regression: `step()` runs inside a setImmediate callback (batch.ts's `tick`),
// which the Promise executor has already returned from — so a throw there is an
// UNCAUGHT EXCEPTION, not a rejection of the returned promise, and the promise
// never settles at all. That distinction is the whole containment story for the
// usage worker: `try { await sweepFiles() } catch` and `void sweep().catch(...)`
// both sit on the promise chain and catch NEITHER, so an ENOENT from a rotated
// log file terminates the utilityProcess (see tests/unit/usage/scanner.test.ts's
// "sweep resilience" block and usage-host-range.test.ts's crash-recovery block).
// processInBatches must surface a callback failure through its own promise.
describe("processInBatches error containment", () => {
	it("rejects when step() throws, rather than escaping the promise chain", async () => {
		await expect(
			processInBatches([1, 2, 3], 1, (n) => {
				if (n === 2) throw new Error("boom");
			}),
		).rejects.toThrow("boom");
	});

	it("stops processing after a failing step", async () => {
		const seen: number[] = [];
		await processInBatches([1, 2, 3, 4], 1, (n) => {
			seen.push(n);
			if (n === 2) throw new Error("boom");
		}).catch(() => {});
		expect(seen).toEqual([1, 2]);
	});
});
