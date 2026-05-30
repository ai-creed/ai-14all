export interface CortexNavLocation {
	workspaceId: string;
	worktreeId: string;
	file: string;
	line: number;
	column?: number;
}

// The location is carried as a single opaque base64url segment rather than as
// URI path segments + query. A cortex:// Location produced by the
// Definition/DocumentLink providers is handed to Monaco, which round-trips it
// through `monaco.Uri.parse(...).toString()` before our opener sees it again.
// That normalization decodes percent-encoded slashes back into real path
// separators (worktreeId is an absolute path, so it would explode into
// segments) and re-encodes `=` in the query — both of which broke the old
// path+query codec. base64url uses only [A-Za-z0-9_-], which no URI normalizer
// rewrites, so encode → Monaco round-trip → decode is lossless.

function base64UrlEncode(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
	const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

export function encodeCortexUri(t: CortexNavLocation): string {
	const payload: Record<string, unknown> = {
		w: t.workspaceId,
		t: t.worktreeId,
		f: t.file,
		l: t.line,
	};
	if (t.column !== undefined) payload.c = t.column;
	return `cortex://nav/${base64UrlEncode(JSON.stringify(payload))}`;
}

export function decodeCortexUri(uri: string): CortexNavLocation | null {
	const prefix = "cortex://nav/";
	if (!uri.startsWith(prefix)) return null;
	// Tolerate a trailing slash / query / fragment a URI normalizer may append.
	const seg = uri.slice(prefix.length).split(/[/?#]/)[0];
	if (!seg) return null;
	let payload: {
		w?: unknown;
		t?: unknown;
		f?: unknown;
		l?: unknown;
		c?: unknown;
	};
	try {
		payload = JSON.parse(base64UrlDecode(seg));
	} catch {
		return null;
	}
	if (
		typeof payload.w !== "string" ||
		typeof payload.t !== "string" ||
		typeof payload.f !== "string" ||
		typeof payload.l !== "number" ||
		!Number.isFinite(payload.l)
	) {
		return null;
	}
	return {
		workspaceId: payload.w,
		worktreeId: payload.t,
		file: payload.f,
		line: payload.l,
		column: typeof payload.c === "number" ? payload.c : undefined,
	};
}
