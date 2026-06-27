export type NavRect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

export type NavTile = {
	id: string;
	rect: NavRect;
	disabled: boolean;
};

export type NavDirection = "up" | "down" | "left" | "right";

// How strongly to penalize cross-axis drift when scoring a candidate. Higher
// values bias movement toward staying in the same visual row/column.
const CROSS_AXIS_WEIGHT = 2;

function centerOf(rect: NavRect): { x: number; y: number } {
	return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

/**
 * Spatial 2D navigation across a wrapped, bucketed tile grid. Returns the id of
 * the nearest enabled tile in `dir` from `currentId`, scoring candidates by
 * distance along the movement axis plus a weighted cross-axis penalty. Returns
 * `currentId` unchanged when no enabled tile lies in that direction (no wrap).
 */
export function nextLayoutTile(
	tiles: NavTile[],
	currentId: string,
	dir: NavDirection,
): string {
	const current = tiles.find((t) => t.id === currentId);
	if (!current) return currentId;
	const from = centerOf(current.rect);

	let best: { id: string; score: number } | null = null;
	for (const tile of tiles) {
		if (tile.id === currentId || tile.disabled) continue;
		const c = centerOf(tile.rect);
		const dx = c.x - from.x;
		const dy = c.y - from.y;

		let primary: number;
		let cross: number;
		if (dir === "left") {
			if (dx >= 0) continue;
			primary = -dx;
			cross = Math.abs(dy);
		} else if (dir === "right") {
			if (dx <= 0) continue;
			primary = dx;
			cross = Math.abs(dy);
		} else if (dir === "up") {
			if (dy >= 0) continue;
			primary = -dy;
			cross = Math.abs(dx);
		} else {
			if (dy <= 0) continue;
			primary = dy;
			cross = Math.abs(dx);
		}

		const score = primary + CROSS_AXIS_WEIGHT * cross;
		if (!best || score < best.score) best = { id: tile.id, score };
	}
	return best ? best.id : currentId;
}
