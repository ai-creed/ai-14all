import { describe, it, expect } from "vitest";
import {
	clampSize,
	applyResize,
	MIN_FLOATING_W,
	MIN_FLOATING_H,
} from "../../../src/features/terminals/logic/floating-shell-resize";

const BIG = { width: 4000, height: 4000 };

describe("clampSize", () => {
	it("caps width at 75% and height at 80% of the window", () => {
		expect(
			clampSize({ width: 9999, height: 9999 }, { width: 1000, height: 1000 }),
		).toEqual({ width: 750, height: 800 });
	});

	it("floors at the minimum size", () => {
		expect(clampSize({ width: 10, height: 10 }, BIG)).toEqual({
			width: MIN_FLOATING_W,
			height: MIN_FLOATING_H,
		});
	});

	it("ceiling wins on a window smaller than the floor", () => {
		// 75% of 500 = 375 < MIN_FLOATING_W (480): the ceiling caps below the floor.
		const out = clampSize(
			{ width: 920, height: 448 },
			{ width: 500, height: 300 },
		);
		expect(out).toEqual({ width: 375, height: 240 });
		expect(out.width).toBeLessThan(MIN_FLOATING_W);
	});
});

describe("applyResize", () => {
	const start = { left: 100, top: 100, width: 920, height: 448 };

	it("east handle grows width only", () => {
		expect(applyResize("e", start, 100, 0, BIG)).toEqual({
			left: 100,
			top: 100,
			width: 1020,
			height: 448,
		});
	});

	it("south handle grows height only", () => {
		expect(applyResize("s", start, 0, 100, BIG)).toEqual({
			left: 100,
			top: 100,
			width: 920,
			height: 548,
		});
	});

	it("west handle grows width and moves left, pinning the right edge", () => {
		const out = applyResize("w", start, -100, 0, BIG);
		expect(out).toEqual({ left: 0, top: 100, width: 1020, height: 448 });
		// Right edge unchanged: left + width === start.left + start.width.
		expect(out.left + out.width).toBe(start.left + start.width);
	});

	it("north handle grows height and moves top, pinning the bottom edge", () => {
		const out = applyResize("n", start, 0, -100, BIG);
		expect(out).toEqual({ left: 100, top: 0, width: 920, height: 548 });
		expect(out.top + out.height).toBe(start.top + start.height);
	});

	it("se corner grows both axes", () => {
		expect(applyResize("se", start, 100, 100, BIG)).toEqual({
			left: 100,
			top: 100,
			width: 1020,
			height: 548,
		});
	});

	it("clamps the resulting size to the same bounds as clampSize", () => {
		const out = applyResize("e", start, 99999, 0, {
			width: 1000,
			height: 1000,
		});
		expect(out.width).toBe(750);
	});
});
