export interface CortexNavLocation {
	workspaceId: string;
	worktreeId: string;
	file: string;
	line: number;
	column?: number;
}

export function encodeCortexUri(t: CortexNavLocation): string {
	const path = t.file.split("/").map(encodeURIComponent).join("/");
	const params = new URLSearchParams({ line: String(t.line) });
	if (t.column !== undefined) params.set("column", String(t.column));
	return `cortex://nav/${encodeURIComponent(t.workspaceId)}/${encodeURIComponent(t.worktreeId)}/${path}?${params}`;
}

export function decodeCortexUri(uri: string): CortexNavLocation | null {
	if (!uri.startsWith("cortex://nav/")) return null;
	let u: URL;
	try {
		u = new URL(uri);
	} catch {
		return null;
	}
	const [ws, wt, ...rest] = u.pathname.replace(/^\//, "").split("/");
	if (!ws || !wt || rest.length === 0) return null;
	const line = Number(u.searchParams.get("line"));
	if (!Number.isFinite(line)) return null;
	const column = u.searchParams.get("column");
	return {
		workspaceId: decodeURIComponent(ws),
		worktreeId: decodeURIComponent(wt),
		file: rest.map(decodeURIComponent).join("/"),
		line,
		column: column !== null ? Number(column) : undefined,
	};
}
