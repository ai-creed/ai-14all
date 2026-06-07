export type HighlightSegment = { text: string; hit: boolean };

/**
 * Splits `text` around the FIRST case-insensitive occurrence of `query`,
 * preserving the original casing. Returns one plain segment when the query is
 * empty or absent. Used to render the matched substring of a symbol name in the
 * accent color.
 */
export function highlightMatch(
	text: string,
	query: string,
): HighlightSegment[] {
	const q = query.trim();
	if (q.length === 0) return [{ text, hit: false }];
	const idx = text.toLowerCase().indexOf(q.toLowerCase());
	if (idx === -1) return [{ text, hit: false }];
	const segments: HighlightSegment[] = [];
	if (idx > 0) segments.push({ text: text.slice(0, idx), hit: false });
	segments.push({ text: text.slice(idx, idx + q.length), hit: true });
	if (idx + q.length < text.length)
		segments.push({ text: text.slice(idx + q.length), hit: false });
	return segments;
}
