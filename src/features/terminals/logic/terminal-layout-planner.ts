import { TERMINAL_LAYOUTS, LAYOUT_IDS, type LayoutId } from "./terminal-layouts";

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
