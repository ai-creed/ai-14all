import { describe, it, expect } from "vitest";
import {
	runningCount,
	compactIntoLayout,
	resolvePromotedLayout,
	planAddPlacement,
	resolveReorganizedLayout,
} from "../../../../src/features/terminals/logic/terminal-layout-planner";
import {
	TERMINAL_LAYOUTS,
	type LayoutId,
} from "../../../../src/features/terminals/logic/terminal-layouts";

describe("runningCount", () => {
	it("counts non-null slots", () => {
		expect(runningCount(["a", null, "b"])).toBe(2);
		expect(runningCount([null, null])).toBe(0);
	});
});

describe("compactIntoLayout", () => {
	it("packs running shells into the first slots of the target layout", () => {
		expect(compactIntoLayout(["a", null, "b"], "2-v")).toEqual(["a", "b"]);
	});
	it("pads with null when target is larger", () => {
		expect(compactIntoLayout(["a", "b"], "4-grid")).toEqual([
			"a",
			"b",
			null,
			null,
		]);
	});
});

describe("resolvePromotedLayout", () => {
	it("keeps the same orientation+distribution when it exists one bucket up", () => {
		expect(resolvePromotedLayout("3-vm")).toBe("4-vm");
		expect(resolvePromotedLayout("4-vm")).toBe("5-vm");
		expect(resolvePromotedLayout("5-vdm")).toBe("6-vdm");
		expect(resolvePromotedLayout("2-v")).toBe("3-v");
		expect(resolvePromotedLayout("2-h")).toBe("3-h");
	});
	it("falls back to same-orientation equal when the family is absent", () => {
		expect(resolvePromotedLayout("4-grid")).toBe("5-v"); // grid -> vertical equal
		expect(resolvePromotedLayout("1")).toBe("2-v"); // single -> vertical equal
	});
	it("returns null when already at 6 slots", () => {
		expect(resolvePromotedLayout("6-vdm")).toBeNull();
		expect(resolvePromotedLayout("6-grid23")).toBeNull();
	});
});

describe("planAddPlacement", () => {
	it("fills the first empty slot without changing the layout", () => {
		expect(
			planAddPlacement({
				terminalLayoutId: "4-grid",
				slotProcessIds: ["a", null, "b", null],
			}),
		).toEqual({ kind: "fill", layoutId: "4-grid", slotIndex: 1 });
	});
	it("auto-promotes when all slots are full", () => {
		expect(
			planAddPlacement({
				terminalLayoutId: "3-vm",
				slotProcessIds: ["a", "b", "c"],
			}),
		).toEqual({ kind: "promote", layoutId: "4-vm", slotIndex: 3 });
	});
	it("reports full at 6 running", () => {
		expect(
			planAddPlacement({
				terminalLayoutId: "6-v",
				slotProcessIds: ["a", "b", "c", "d", "e", "f"],
			}),
		).toEqual({ kind: "full" });
	});
});

describe("resolveReorganizedLayout", () => {
	// helper: close one slot of `currentId` and return the resolved layout.
	const afterClosing = (currentId: LayoutId, closedIndex: number): LayoutId => {
		const n = TERMINAL_LAYOUTS[currentId].slotCount;
		const surviving = Array.from({ length: n }, (_, i) => i).filter(
			(i) => i !== closedIndex,
		);
		return resolveReorganizedLayout(currentId, surviving);
	};

	it("returns '1' for one or zero survivors", () => {
		expect(resolveReorganizedLayout("2-v", [0])).toBe("1");
		expect(resolveReorganizedLayout("2-v", [])).toBe("1");
		expect(afterClosing("2-v", 0)).toBe("1");
		expect(afterClosing("2-h", 1)).toBe("1");
	});

	it("shrinks equal layouts to the same-orientation equal one bucket down", () => {
		expect(afterClosing("3-v", 1)).toBe("2-v");
		expect(afterClosing("3-h", 1)).toBe("2-h");
		expect(afterClosing("4-v", 0)).toBe("3-v");
		expect(afterClosing("4-h", 2)).toBe("3-h");
	});

	it("chooses orientation by where the survivors sit (master case)", () => {
		// 3-vm = [ A(master, left) | B/C stacked right ]
		expect(afterClosing("3-vm", 0)).toBe("2-h"); // close master -> B above C
		expect(afterClosing("3-vm", 1)).toBe("2-v"); // close child -> A beside survivor
		expect(afterClosing("3-vm", 2)).toBe("2-v");
		// 3-hm = [ A(master, top) / B | C ]
		expect(afterClosing("3-hm", 0)).toBe("2-v"); // close master -> B beside C
		expect(afterClosing("3-hm", 1)).toBe("2-h"); // close child -> A above survivor
		expect(afterClosing("3-hm", 2)).toBe("2-h");
	});

	it("preserves the master shape when a child closes", () => {
		expect(afterClosing("4-vm", 1)).toBe("3-vm"); // A stays master, B/C stacked
		expect(afterClosing("4-vm", 3)).toBe("3-vm");
		expect(afterClosing("4-hm", 1)).toBe("3-hm");
	});

	it("collapses the master to a stacked/equal split when the master closes", () => {
		expect(afterClosing("4-vm", 0)).toBe("3-h"); // B/C/D stacked in a column
		expect(afterClosing("4-hm", 0)).toBe("3-v"); // bottom row survivors side by side
	});

	it("falls back to an equal split for grid remnants", () => {
		// A 2x2 (or 2x3) grid minus one cell is an L-shape no smaller layout matches.
		expect(afterClosing("4-grid", 0)).toBe("3-v");
		expect(afterClosing("4-grid", 1)).toBe("3-v");
		expect(afterClosing("4-grid", 2)).toBe("3-v");
		expect(afterClosing("4-grid", 3)).toBe("3-v");
		expect(afterClosing("6-grid23", 0)).toBe("5-v");
		expect(afterClosing("6-grid32", 5)).toBe("5-v");
	});

	it("returns a valid same-count layout for double-master closes", () => {
		for (const closed of [0, 1, 2, 3, 4]) {
			const result = afterClosing("5-vdm", closed);
			expect(TERMINAL_LAYOUTS[result].slotCount).toBe(4);
			const result2 = afterClosing("5-hdm", closed);
			expect(TERMINAL_LAYOUTS[result2].slotCount).toBe(4);
		}
	});

	it("is deterministic for identical inputs", () => {
		expect(resolveReorganizedLayout("4-grid", [1, 2, 3])).toBe(
			resolveReorganizedLayout("4-grid", [1, 2, 3]),
		);
	});
});
