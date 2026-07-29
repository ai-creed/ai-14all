// Per-bucket "before this zone's own retained anchor" flags (design spec
// §2.9/§4.7/AC3/AC4: each source stubs before ITS OWN retained anchor, never
// a source shared with another zone — app time before appRetainedSinceMs,
// runs before runsRetainedSinceMs, tokens before the ledger's earliestDayMs).
// A bucket is "precapture" when it lies entirely before the anchor instant;
// with a null anchor (nothing retained for that source yet) every bucket is
// precapture. This one function is what makes the floor-padded weeks read as
// "no data" in every capture-bound zone: those weeks sit before ALL three
// anchors by construction (domainForRange's data-start = min of the three),
// so each zone's own-anchor comparison already marks them precapture without
// any special-cased floor-mode branch.
export function precaptureFlags(
	edges: number[],
	anchorMs: number | null,
): boolean[] {
	const bucketCount = Math.max(edges.length - 1, 0);
	if (anchorMs === null) return new Array(bucketCount).fill(true);
	return Array.from(
		{ length: bucketCount },
		(_, i) => edges[i + 1] <= anchorMs,
	);
}

// Index of the first non-precapture bucket, or -1 when every bucket is
// precapture (nothing retained for this source at all in the domain).
export function dataStartIndex(flags: boolean[]): number {
	return flags.findIndex((f) => !f);
}
