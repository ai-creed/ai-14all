import { BINARY_SNIFF_BYTES } from "../../shared/files/size-limits.js";

export function isLikelyBinary(buf: Buffer): boolean {
	const slice = buf.subarray(0, Math.min(buf.length, BINARY_SNIFF_BYTES));
	if (slice.length === 0) return false;
	if (slice.includes(0)) return true;
	let nonPrintable = 0;
	for (const byte of slice) {
		if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++;
	}
	return nonPrintable / slice.length > 0.3;
}
