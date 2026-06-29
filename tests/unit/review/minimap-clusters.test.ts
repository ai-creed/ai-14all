import { describe, expect, it } from "vitest";
import { clusterDots, type Dot } from "../../../src/features/review/logic/minimap-clusters";

const d = (id: string, position: number): Dot => ({ id, position, status: "open" });

describe("clusterDots", () => {
	it("keeps far-apart dots separate", () => {
		const out = clusterDots([d("a", 0.1), d("b", 0.9)], 0.02);
		expect(out).toHaveLength(2);
	});

	it("merges dots within the threshold", () => {
		const out = clusterDots([d("a", 0.50), d("b", 0.51)], 0.02);
		expect(out).toHaveLength(1);
		expect(out[0]!.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
		expect(out[0]!.position).toBeCloseTo(0.505, 5);
	});

	it("sorts input by position before clustering", () => {
		const out = clusterDots([d("b", 0.9), d("a", 0.1)], 0.02);
		expect(out[0]!.position).toBeCloseTo(0.1, 5);
	});

	it("returns [] for no dots", () => {
		expect(clusterDots([], 0.02)).toEqual([]);
	});

	it("collapses dense regions: 200 evenly-spaced dots with threshold 0.02 produce fewer than 200 clusters", () => {
		const dots: Dot[] = Array.from({ length: 200 }, (_, i) => d(`d${i}`, i / 200));
		const clusters = clusterDots(dots, 0.02);
		expect(clusters.length).toBeLessThan(200);
	});
});
