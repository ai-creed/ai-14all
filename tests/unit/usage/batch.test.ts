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
