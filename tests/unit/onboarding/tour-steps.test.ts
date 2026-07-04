import { describe, expect, it } from "vitest";
import {
	CURRENT_TOUR_VERSION,
	TOUR_STEPS,
} from "../../../src/features/onboarding/logic/tour-steps";

describe("tour-steps", () => {
	it("has a positive integer version", () => {
		expect(Number.isInteger(CURRENT_TOUR_VERSION)).toBe(true);
		expect(CURRENT_TOUR_VERSION).toBeGreaterThan(0);
	});

	it("defines exactly four steps with unique ids and anchors", () => {
		expect(TOUR_STEPS).toHaveLength(4);
		expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(4);
		expect(new Set(TOUR_STEPS.map((s) => s.anchorId)).size).toBe(4);
	});

	it("uses contiguous order values starting at 0", () => {
		const orders = TOUR_STEPS.map((s) => s.order).sort((a, b) => a - b);
		expect(orders).toEqual([0, 1, 2, 3]);
	});

	it("anchors the four critical-path surfaces", () => {
		expect(TOUR_STEPS.map((s) => s.anchorId)).toEqual([
			"sidebar-tree",
			"agent-launcher",
			"session-row",
			"review-bar",
		]);
	});

	it("gives every step a non-empty title and body", () => {
		for (const s of TOUR_STEPS) {
			expect(s.title.length).toBeGreaterThan(0);
			expect(s.body.length).toBeGreaterThan(0);
		}
	});
});
