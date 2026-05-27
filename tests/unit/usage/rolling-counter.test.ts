import { describe, expect, it } from "vitest";
import { RollingCounter } from "../../../services/usage/rolling-counter.js";

const MIN = 60_000;

describe("RollingCounter", () => {
	it("sums only amounts within the window", () => {
		const c = new RollingCounter({ windowMs: 60 * MIN, bucketMs: 5 * MIN });
		const now = 1_000_000_000_000;
		c.add(now - 90 * MIN, 100); // outside window
		c.add(now - 30 * MIN, 10);
		c.add(now - 1 * MIN, 5);
		expect(c.sum(now)).toBe(15);
	});
	it("prunes old buckets on add to stay bounded", () => {
		const c = new RollingCounter({ windowMs: 10 * MIN, bucketMs: 1 * MIN });
		const now = 2_000_000_000_000;
		for (let i = 0; i < 1000; i++) c.add(now - i * MIN, 1);
		expect(c.bucketCount()).toBeLessThanOrEqual(12);
		expect(c.sum(now)).toBe(11);
	});
});
