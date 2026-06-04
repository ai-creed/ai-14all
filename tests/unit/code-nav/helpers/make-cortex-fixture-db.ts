import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export interface CortexFixture {
	meta?: Record<string, string>;
	functions?: Array<{
		qualified_name: string;
		file: string;
		line: number;
		col?: number | null;
		end_line?: number | null;
		end_col?: number | null;
		exported?: number;
		is_default_export?: number;
		is_declaration_only?: number;
	}>;
	calls?: Array<{
		from_key: string;
		to_key: string;
		kind: string;
		site_line?: number | null;
		site_col?: number | null;
		site_end_line?: number | null;
		site_end_col?: number | null;
	}>;
	imports?: Array<{ from_path: string; to_path: string }>;
	files?: Array<{ path: string; kind: string; content_hash?: string | null }>;
}

/** Builds a cortex-shaped v3.1 `.db` at dbPath (mirrors cortex's table layout). */
export function makeCortexFixtureDb(
	dbPath: string,
	fx: CortexFixture = {},
): void {
	mkdirSync(dirname(dbPath), { recursive: true }); // tests pass nested <repoKey>/<key>.db paths
	// Start from a clean file so the helper is idempotent on the same path
	// (the skip/re-ingest test rewrites the cortex db with a new fingerprint,
	// simulating cortex re-indexing). Plain CREATE TABLE would otherwise throw
	// "table already exists" on the second call.
	for (const suffix of ["", "-wal", "-shm"])
		rmSync(`${dbPath}${suffix}`, { force: true });
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.exec(`
		CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE files (path TEXT PRIMARY KEY, kind TEXT NOT NULL, content_hash TEXT);
		CREATE TABLE docs (path TEXT PRIMARY KEY, title TEXT, body TEXT);
		CREATE TABLE imports (from_path TEXT NOT NULL, to_path TEXT NOT NULL);
		CREATE TABLE functions (
			qualified_name TEXT NOT NULL, file TEXT NOT NULL, exported INTEGER,
			is_default_export INTEGER, line INTEGER, is_declaration_only INTEGER,
			col INTEGER, end_line INTEGER, end_col INTEGER, id TEXT
		);
		CREATE TABLE calls (
			from_key TEXT NOT NULL, to_key TEXT NOT NULL, kind TEXT NOT NULL,
			site_line INTEGER, site_col INTEGER, site_end_line INTEGER, site_end_col INTEGER
		);
	`);
	const meta: Record<string, string> = {
		schemaVersion: "3.1",
		fingerprint: "fp1",
		indexedAt: "2026-06-04T00:00:00Z",
		repoKey: "repoA",
		worktreeKey: "wtA",
		worktreePath: "/fixture/wt",
		dirtyAtIndex: "0",
		...(fx.meta ?? {}),
	};
	const im = db.prepare("INSERT INTO meta (key, value) VALUES (?,?)");
	for (const [k, v] of Object.entries(meta)) im.run(k, String(v));
	const inf = db.prepare(
		"INSERT INTO functions (qualified_name, file, exported, is_default_export, line, is_declaration_only, col, end_line, end_col, id) VALUES (?,?,?,?,?,?,?,?,?,?)",
	);
	for (const f of fx.functions ?? [])
		inf.run(
			f.qualified_name,
			f.file,
			f.exported ?? 0,
			f.is_default_export ?? 0,
			f.line,
			f.is_declaration_only ?? 0,
			f.col ?? null,
			f.end_line ?? null,
			f.end_col ?? null,
			"",
		);
	const inc = db.prepare(
		"INSERT INTO calls (from_key, to_key, kind, site_line, site_col, site_end_line, site_end_col) VALUES (?,?,?,?,?,?,?)",
	);
	for (const c of fx.calls ?? [])
		inc.run(
			c.from_key,
			c.to_key,
			c.kind,
			c.site_line ?? null,
			c.site_col ?? null,
			c.site_end_line ?? null,
			c.site_end_col ?? null,
		);
	const ii = db.prepare(
		"INSERT INTO imports (from_path, to_path) VALUES (?,?)",
	);
	for (const i of fx.imports ?? []) ii.run(i.from_path, i.to_path);
	const iff = db.prepare(
		"INSERT INTO files (path, kind, content_hash) VALUES (?,?,?)",
	);
	for (const f of fx.files ?? [])
		iff.run(f.path, f.kind, f.content_hash ?? null);
	db.close();
}
