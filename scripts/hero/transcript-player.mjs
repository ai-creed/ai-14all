// scripts/hero/transcript-player.mjs — pure player; IO injected for tests.
export function parseTranscript(jsonlText) {
	return jsonlText
		.split("\n")
		.filter((l) => l.trim().length > 0)
		.map((l) => JSON.parse(l));
}

export async function play(items, io) {
	for (const item of items) {
		if (item.gate !== undefined) {
			await io.waitGate(
				item.gate,
				item.idleChunk
					? { chunk: item.idleChunk, everyMs: item.idleEveryMs ?? 150 }
					: undefined,
			);
		}
		if (item.delayMs > 0) await io.sleep(item.delayMs);
		if (item.chunk !== undefined) io.write(item.chunk);
		else if (item.text !== undefined) io.write(item.text + "\n");
		if (item.marker) io.appendMark(item.marker, io.now());
	}
}
