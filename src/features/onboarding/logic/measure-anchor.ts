/** CSS selector for a tour anchor id. */
export function anchorSelector(anchorId: string): string {
	return `[data-tour="${anchorId}"]`;
}

/**
 * The on-screen rect of a tour anchor, or null when it is not mounted. When an
 * id is used on multiple elements (session rows), the first in document order
 * is measured — that is the top row we want to spotlight.
 */
export function measureAnchor(anchorId: string): DOMRect | null {
	const el = document.querySelector(anchorSelector(anchorId));
	return el ? el.getBoundingClientRect() : null;
}
