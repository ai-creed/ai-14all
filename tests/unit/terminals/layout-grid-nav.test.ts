import { describe, it, expect } from "vitest";
import {
	nextLayoutTile,
	type NavTile,
} from "../../../src/features/terminals/logic/layout-grid-nav";

// A fixture mirroring the dialog's bucketed, wrapped layout. Rows are buckets;
// columns are tiles within a bucket. Coordinates are arbitrary but consistent.
function tile(id: string, col: number, row: number, disabled = false): NavTile {
	const left = col * 110;
	const top = row * 60;
	return {
		id,
		rect: { left, top, right: left + 100, bottom: top + 50 },
		disabled,
	};
}

// bucket 1 (row 0): one tile. bucket 2 (row 1): two. bucket 3 (row 2): four.
const TILES: NavTile[] = [
	tile("1", 0, 0),
	tile("2-v", 0, 1),
	tile("2-h", 1, 1),
	tile("3-v", 0, 2),
	tile("3-h", 1, 2),
	tile("3-vm", 2, 2),
	tile("3-hm", 3, 2),
];

describe("nextLayoutTile", () => {
	it("moves an interior tile left/right/up/down to the expected neighbor", () => {
		// Interior tile "3-h": all four directions land on the visual neighbor.
		expect(nextLayoutTile(TILES, "3-h", "left")).toBe("3-v");
		expect(nextLayoutTile(TILES, "3-h", "right")).toBe("3-vm");
		expect(nextLayoutTile(TILES, "3-h", "up")).toBe("2-h");
		// Interior downward move (3-h has no bucket below it, so demonstrate the
		// downward neighbor from "2-h", which sits directly above "3-h").
		expect(nextLayoutTile(TILES, "2-h", "down")).toBe("3-h");
		expect(nextLayoutTile(TILES, "2-v", "down")).toBe("3-v");
	});

	it("crosses buckets vertically to the nearest column", () => {
		expect(nextLayoutTile(TILES, "2-h", "up")).toBe("1");
	});

	it("does not wrap at any edge (returns the same id)", () => {
		// left edge, right edge, top edge, bottom edge — each returns the same id.
		expect(nextLayoutTile(TILES, "3-v", "left")).toBe("3-v");
		expect(nextLayoutTile(TILES, "3-hm", "right")).toBe("3-hm");
		expect(nextLayoutTile(TILES, "1", "up")).toBe("1");
		expect(nextLayoutTile(TILES, "3-h", "down")).toBe("3-h");
	});

	it("skips disabled tiles as candidates", () => {
		const withDisabled = TILES.map((t) =>
			t.id === "3-vm" ? { ...t, disabled: true } : t,
		);
		expect(nextLayoutTile(withDisabled, "3-h", "right")).toBe("3-hm");
	});

	it("returns the same id when the current id is unknown", () => {
		expect(nextLayoutTile(TILES, "does-not-exist", "down")).toBe(
			"does-not-exist",
		);
	});
});
