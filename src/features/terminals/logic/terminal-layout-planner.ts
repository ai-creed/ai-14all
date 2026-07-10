import {
	TERMINAL_LAYOUTS,
	LAYOUT_IDS,
	type LayoutId,
} from "./terminal-layouts";

export function runningCount(slots: (string | null)[]): number {
	return slots.filter((s) => s !== null).length;
}

/** Pack the running shells (in order) into the first slots of `layoutId`. */
export function compactIntoLayout(
	slots: (string | null)[],
	layoutId: LayoutId,
): (string | null)[] {
	const running = slots.filter((s): s is string => s !== null);
	const n = TERMINAL_LAYOUTS[layoutId].slotCount;
	return Array.from({ length: n }, (_, i) => running[i] ?? null);
}

/**
 * The layout to grow into when adding a shell to a full layout: same
 * orientation+distribution one bucket up, else same-orientation Equal, else
 * (grid/none) vertical Equal. Returns null when already at 6 slots.
 */
export function resolvePromotedLayout(currentId: LayoutId): LayoutId | null {
	const cur = TERMINAL_LAYOUTS[currentId];
	const target = cur.slotCount + 1;
	if (target > 6) return null;
	const inTarget = LAYOUT_IDS.filter(
		(id) => TERMINAL_LAYOUTS[id].slotCount === target,
	);
	// 1. exact orientation + distribution
	const exact = inTarget.find((id) => {
		const d = TERMINAL_LAYOUTS[id];
		return (
			d.orientation === cur.orientation && d.distribution === cur.distribution
		);
	});
	if (exact) return exact;
	// 2. same orientation Equal (grid/none orientation -> vertical)
	const orientation = cur.orientation === "none" ? "vertical" : cur.orientation;
	const equal = inTarget.find((id) => {
		const d = TERMINAL_LAYOUTS[id];
		return d.distribution === "equal" && d.orientation === orientation;
	});
	if (equal) return equal;
	// 3. any vertical equal as last resort
	return (
		inTarget.find(
			(id) =>
				TERMINAL_LAYOUTS[id].distribution === "equal" &&
				TERMINAL_LAYOUTS[id].orientation === "vertical",
		) ?? null
	);
}

export type AddPlacement =
	| { kind: "fill"; layoutId: LayoutId; slotIndex: number }
	| { kind: "promote"; layoutId: LayoutId; slotIndex: number }
	| { kind: "full" };

/** Decide where a newly added shell goes. */
export function planAddPlacement(session: {
	terminalLayoutId: LayoutId;
	slotProcessIds: (string | null)[];
}): AddPlacement {
	const emptyIndex = session.slotProcessIds.findIndex((s) => s === null);
	if (emptyIndex >= 0)
		return {
			kind: "fill",
			layoutId: session.terminalLayoutId,
			slotIndex: emptyIndex,
		};
	const running = runningCount(session.slotProcessIds);
	if (running >= 6) return { kind: "full" };
	const promoted = resolvePromotedLayout(session.terminalLayoutId);
	if (!promoted) return { kind: "full" };
	return { kind: "promote", layoutId: promoted, slotIndex: running };
}

type Range = { start: number; end: number };
type Rel = "before" | "after" | "overlap";
type Placement = { col: Range; row: Range };

function parseGridRange(value: string): Range {
	const [start, end] = value.split("/").map((p) => Number(p.trim()));
	return { start, end };
}

function placementOf(p: { gridColumn: string; gridRow: string }): Placement {
	return {
		col: parseGridRange(p.gridColumn),
		row: parseGridRange(p.gridRow),
	};
}

// Relation of `a` to `b` along one axis: does a come entirely before b,
// entirely after, or do their ranges overlap (share a band)?
function relate(a: Range, b: Range): Rel {
	if (a.end <= b.start) return "before";
	if (b.end <= a.start) return "after";
	return "overlap";
}

// +1 for each preserved axis-relation across every survivor pair.
function scoreCandidate(
	survivors: Placement[],
	candidate: Placement[],
): number {
	let score = 0;
	for (let i = 0; i < survivors.length; i++) {
		for (let j = i + 1; j < survivors.length; j++) {
			if (
				relate(survivors[i].col, survivors[j].col) ===
				relate(candidate[i].col, candidate[j].col)
			)
				score++;
			if (
				relate(survivors[i].row, survivors[j].row) ===
				relate(candidate[i].row, candidate[j].row)
			)
				score++;
		}
	}
	return score;
}

// True when every range shares at least one common unit (non-empty intersection).
function shareBand(ranges: Range[]): boolean {
	const start = Math.max(...ranges.map((r) => r.start));
	const end = Math.min(...ranges.map((r) => r.end));
	return start < end;
}

/**
 * The layout to reorganize into after a close, chosen by best-fit against the
 * surviving panes' current grid placements. `survivingSlotIndices` are indices
 * into currentId's slotPlacements that still hold a running shell, in ascending
 * slot order. Returns "1" for <= 1 survivors.
 */
export function resolveReorganizedLayout(
	currentId: LayoutId,
	survivingSlotIndices: number[],
): LayoutId {
	const n = survivingSlotIndices.length;
	if (n <= 1) return "1";

	const current = TERMINAL_LAYOUTS[currentId];
	const survivors = survivingSlotIndices.map((i) =>
		placementOf(current.slotPlacements[i]),
	);

	const candidates = LAYOUT_IDS.filter(
		(id) => TERMINAL_LAYOUTS[id].slotCount === n,
	);
	const maxScore = n * (n - 1); // 2 * C(n, 2)

	let best: LayoutId = candidates[0];
	let bestScore = -1;
	for (const id of candidates) {
		const cand = TERMINAL_LAYOUTS[id].slotPlacements.map(placementOf);
		const score = scoreCandidate(survivors, cand);
		// Strict `>` keeps the catalog-earliest layout on ties (deterministic).
		if (score > bestScore) {
			bestScore = score;
			best = id;
		}
	}

	// Perfect match preserves master/grid shapes when survivors still form them.
	if (bestScore === maxScore) return best;

	// Grid remnant: equal split oriented by the survivors' dominant axis.
	const rowCommon = shareBand(survivors.map((s) => s.row));
	const colCommon = shareBand(survivors.map((s) => s.col));
	const orientation = rowCommon ? "v" : colCommon ? "h" : "v";
	return `${n}-${orientation}` as LayoutId;
}
