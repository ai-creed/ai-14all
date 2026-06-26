export const MIN_FLOATING_W = 480;
export const MIN_FLOATING_H = 280;
export const MAX_W_FRACTION = 0.75;
export const MAX_H_FRACTION = 0.8;

export type Size = { width: number; height: number };
export type Rect = { left: number; top: number; width: number; height: number };
export type WindowSize = { width: number; height: number };
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Clamp a requested popover size: floor at MIN_FLOATING_*, ceiling at 75% of the
 * window width / 80% of its height. On a window smaller than the floor the
 * ceiling wins automatically — Math.max lifts the request to the floor, then
 * Math.min lowers it to the (smaller) ceiling — so the popover never exceeds the
 * viewport.
 */
export function clampSize(req: Size, win: WindowSize): Size {
	const ceilW = win.width * MAX_W_FRACTION;
	const ceilH = win.height * MAX_H_FRACTION;
	return {
		width: Math.min(ceilW, Math.max(MIN_FLOATING_W, req.width)),
		height: Math.min(ceilH, Math.max(MIN_FLOATING_H, req.height)),
	};
}

/**
 * Apply a pointer delta for a resize handle to a starting rect, keeping the
 * opposite edge pinned (west/north handles shift left/top as they resize), then
 * clamp the size. The left/top shift is computed from the *clamped* dimension so
 * the pinned edge stays fixed even when the clamp caps the drag.
 */
export function applyResize(
	handle: ResizeHandle,
	start: Rect,
	dx: number,
	dy: number,
	win: WindowSize,
): Rect {
	let width = start.width;
	let height = start.height;
	if (handle.includes("e")) width = start.width + dx;
	if (handle.includes("w")) width = start.width - dx;
	if (handle.includes("s")) height = start.height + dy;
	if (handle.includes("n")) height = start.height - dy;

	const clamped = clampSize({ width, height }, win);

	let left = start.left;
	let top = start.top;
	if (handle.includes("w")) left = start.left + (start.width - clamped.width);
	if (handle.includes("n")) top = start.top + (start.height - clamped.height);

	return { left, top, width: clamped.width, height: clamped.height };
}
