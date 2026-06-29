// src/features/review/logic/content-hash.ts

/**
 * Fast, non-cryptographic content fingerprint (FNV-1a, 32-bit). Used only to
 * detect that a reviewed file's content changed since it was marked viewed, so
 * the "reviewed" mark can auto-revert. Not a security hash. Synchronous so it
 * can run inline in render/handlers without an async hop.
 */
export function hashContent(content: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) {
		h ^= content.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}
