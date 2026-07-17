// Opaque continuation token: (epoch, watermark, line) — spec §2. Base64 JSON;
// the phone never introspects it. decode() is forgiving: anything unreadable
// is treated as "no cursor" (fresh snapshot), never an error.
export type PtyCursor = { epoch: number; watermark: number; line: number };

export function encodeCursor(c: PtyCursor): string {
	return Buffer.from(JSON.stringify([c.epoch, c.watermark, c.line])).toString(
		"base64url",
	);
}

export function decodeCursor(raw: string | null): PtyCursor | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
		if (!Array.isArray(parsed) || parsed.length !== 3) return null;
		const [epoch, watermark, line] = parsed;
		if (
			typeof epoch !== "number" ||
			typeof watermark !== "number" ||
			typeof line !== "number"
		)
			return null;
		return { epoch, watermark, line };
	} catch {
		return null;
	}
}
