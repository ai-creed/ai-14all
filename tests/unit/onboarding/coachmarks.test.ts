import { describe, expect, it } from "vitest";
import { COACHMARKS } from "../../../src/features/onboarding/logic/coachmarks";

describe("coachmarks", () => {
	it("defines four coachmarks with unique ids and anchors", () => {
		expect(COACHMARKS).toHaveLength(4);
		expect(new Set(COACHMARKS.map((c) => c.id)).size).toBe(4);
		expect(new Set(COACHMARKS.map((c) => c.anchorId)).size).toBe(4);
	});
	it("targets the four secondary surfaces", () => {
		expect(COACHMARKS.map((c) => c.anchorId).sort()).toEqual([
			"command-palette",
			"plugins",
			"settings-footer",
			"telemetry",
		]);
	});
	it("gives every coachmark non-empty copy", () => {
		for (const c of COACHMARKS) {
			expect(c.title.length).toBeGreaterThan(0);
			expect(c.body.length).toBeGreaterThan(0);
		}
	});
});
