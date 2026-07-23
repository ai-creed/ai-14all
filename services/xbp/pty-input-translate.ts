// Host-owned named-key → byte translation (umbrella §5.4, normative). The
// phone never synthesizes these bytes — and the schema's printable-only
// PtyText means free text can never carry them either; named keys are the
// ONLY path to control bytes. Chunks concatenate into ONE string so the
// executor performs a single contiguous write.
import type { PtyInputChunk, PtyInputKey } from "@ai-creed/command-contract";

const KEY_BYTES: Record<PtyInputKey, string> = {
	enter: "\r", // CR, 0x0D
	up: "\x1b[A",
	down: "\x1b[B",
	esc: "\x1b", // 0x1B
	"ctrl-c": "\x03", // ETX → SIGINT via the pty line discipline
};

export function translatePtyInputChunks(chunks: PtyInputChunk[]): string {
	return chunks
		.map((chunk) => ("text" in chunk ? chunk.text : KEY_BYTES[chunk.key]))
		.join("");
}
