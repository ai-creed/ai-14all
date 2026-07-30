// scripts/hero/transcript-player.mjs — pure player; IO injected for tests.
export function parseTranscript(jsonlText) {
	return jsonlText
		.split("\n")
		.filter((l) => l.trim().length > 0)
		.map((l) => JSON.parse(l));
}

export async function play(items, io) {
	// Deadline-based scheduling: track an absolute target instead of chaining
	// per-item sleeps, so real-world setTimeout overshoot never accumulates.
	let nextAt = io.now();
	for (const item of items) {
		if (item.gate !== undefined) {
			await io.waitGate(
				item.gate,
				item.idleChunk
					? { chunk: item.idleChunk, everyMs: item.idleEveryMs ?? 150 }
					: undefined,
			);
			// The gate wait is external/variable — resync the deadline baseline
			// to the moment it resolved instead of letting it count as drift.
			nextAt = io.now();
		}
		nextAt += item.delayMs;
		const wait = nextAt - io.now();
		if (wait > 0) await io.sleep(wait);
		if (item.chunk !== undefined) io.write(item.chunk);
		else if (item.text !== undefined) io.write(item.text + "\n");
		if (item.marker) io.appendMark(item.marker, io.now());
	}
}
