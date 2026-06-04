// Row/meta shapes for ai-cortex's v3.1 per-worktree SQLite store. The only
// place (besides CortexStoreReader) that mirrors cortex's column names.

export interface CortexStoreMeta {
	schemaVersion: string; // e.g. "3.1"
	fingerprint: string;
	indexedAt: string;
	dirtyAtIndex: boolean; // false when the meta key is absent
	repoKey: string;
	worktreeKey: string;
	worktreePath: string;
}

export interface CortexFunctionRow {
	qualified_name: string;
	file: string;
	line: number;
	col: number | null;
	end_line: number | null;
	end_col: number | null;
	exported: number; // 0 | 1
	is_default_export: number; // 0 | 1
	is_declaration_only: number; // 0 | 1
}

export interface CortexCallRow {
	from_key: string; // `${file}::${qualifiedName}`
	to_key: string; // resolved `${file}::${name}` or unresolved `::${name}`
	kind: string;
	site_line: number | null;
	site_col: number | null;
	site_end_line: number | null;
	site_end_col: number | null;
}

export interface CortexImportRow {
	from_path: string;
	to_path: string;
}

export interface CortexFileRow {
	path: string;
	kind: string;
	content_hash: string | null;
}

export interface CortexGraph {
	functions: CortexFunctionRow[];
	calls: CortexCallRow[];
	imports: CortexImportRow[];
	files: CortexFileRow[];
}
