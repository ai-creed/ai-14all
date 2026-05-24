import { describe, it, expect } from "vitest";
import {
	TERMINAL_LAYOUTS,
	LAYOUT_IDS,
	getLayout,
	type LayoutId,
} from "../../../../src/features/terminals/logic/terminal-layouts";

describe("TERMINAL_LAYOUTS catalog", () => {
	it("has exactly 26 layouts", () => {
		expect(LAYOUT_IDS).toHaveLength(26);
		expect(Object.keys(TERMINAL_LAYOUTS)).toHaveLength(26);
	});

	it("each descriptor's slotPlacements length equals slotCount", () => {
		for (const id of LAYOUT_IDS) {
			const d = TERMINAL_LAYOUTS[id];
			expect(d.slotPlacements.length, id).toBe(d.slotCount);
		}
	});

	it("masterSlots is consistent with distribution", () => {
		for (const id of LAYOUT_IDS) {
			const d = TERMINAL_LAYOUTS[id];
			if (d.distribution === "master") expect(d.masterSlots, id).toBe(1);
			else if (d.distribution === "double-master")
				expect(d.masterSlots, id).toBe(2);
			else expect(d.masterSlots, id).toBe(0);
			expect(d.masterSlots).toBeLessThanOrEqual(d.slotCount);
		}
	});

	it("id field matches its key", () => {
		for (const id of LAYOUT_IDS) expect(TERMINAL_LAYOUTS[id].id).toBe(id);
	});

	it("slotCount distribution covers buckets 1..6 with the expected counts", () => {
		const byCount: Record<number, number> = {};
		for (const id of LAYOUT_IDS)
			byCount[TERMINAL_LAYOUTS[id].slotCount] =
				(byCount[TERMINAL_LAYOUTS[id].slotCount] ?? 0) + 1;
		expect(byCount).toEqual({ 1: 1, 2: 2, 3: 4, 4: 5, 5: 6, 6: 8 });
	});

	it("getLayout returns the descriptor", () => {
		const id: LayoutId = "4-grid";
		expect(getLayout(id).slotCount).toBe(4);
	});
});
