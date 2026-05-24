import { describe, it, expect } from "vitest";
import {
	runningCount,
	compactIntoLayout,
	resolvePromotedLayout,
	planAddPlacement,
} from "../../../../src/features/terminals/logic/terminal-layout-planner";

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
		expect(compactIntoLayout(["a", "b"], "4-grid")).toEqual(["a", "b", null, null]);
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
			planAddPlacement({ terminalLayoutId: "4-grid", slotProcessIds: ["a", null, "b", null] }),
		).toEqual({ kind: "fill", layoutId: "4-grid", slotIndex: 1 });
	});
	it("auto-promotes when all slots are full", () => {
		expect(
			planAddPlacement({ terminalLayoutId: "3-vm", slotProcessIds: ["a", "b", "c"] }),
		).toEqual({ kind: "promote", layoutId: "4-vm", slotIndex: 3 });
	});
	it("reports full at 6 running", () => {
		expect(
			planAddPlacement({ terminalLayoutId: "6-v", slotProcessIds: ["a", "b", "c", "d", "e", "f"] }),
		).toEqual({ kind: "full" });
	});
});
