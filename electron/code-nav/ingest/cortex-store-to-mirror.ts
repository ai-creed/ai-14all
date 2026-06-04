import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { CortexStoreReader } from "../source/cortex-store-reader.js";
import { isSupportedSchemaVersion } from "../source/version-compat.js";
import { SCHEMA_SQL } from "./schema.js";

export const CODE_NAV_SCHEMA_VERSION = 2;

export type IngestResult =
	| {
			unavailable: true;
			reason: "no-store" | "unsupported-schema";
			schemaVersion?: string;
	  }
	| { unavailable?: false; skipped: boolean; functionsCount: number };

function bareName(qualified: string): string {
	const idx = qualified.lastIndexOf("::");
	return idx >= 0 ? qualified.slice(idx + 2) : qualified;
}

export function ingestCortexStore(
	cortexDbPath: string,
	mirrorDbPath: string,
): IngestResult {
	const reader = new CortexStoreReader(cortexDbPath);
	const meta = reader.readMeta();
	if (!meta) return { unavailable: true, reason: "no-store" };
	if (!isSupportedSchemaVersion(meta.schemaVersion))
		return {
			unavailable: true,
			reason: "unsupported-schema",
			schemaVersion: meta.schemaVersion,
		};

	mkdirSync(dirname(mirrorDbPath), { recursive: true });
	const sidecarPath = mirrorDbPath.replace(/\.sqlite$/, ".meta.json");

	if (existsSync(mirrorDbPath) && existsSync(sidecarPath)) {
		try {
			const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as {
				source_fingerprint?: string;
				schema_version?: number;
				functions_count?: number;
			};
			if (
				sidecar.source_fingerprint === meta.fingerprint &&
				sidecar.schema_version === CODE_NAV_SCHEMA_VERSION
			)
				return { skipped: true, functionsCount: sidecar.functions_count ?? 0 };
		} catch {
			// fall through and rebuild
		}
	}

	const graph = reader.readGraph();
	const db = new Database(mirrorDbPath);
	try {
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");
		// Full rebuild: drop everything so a schema_version bump (new columns)
		// always takes effect on a pre-existing mirror file.
		db.exec(`
			DROP TABLE IF EXISTS calls;
			DROP TRIGGER IF EXISTS functions_ai;
			DROP TRIGGER IF EXISTS functions_ad;
			DROP TABLE IF EXISTS functions_fts;
			DROP TABLE IF EXISTS functions;
			DROP TABLE IF EXISTS imports;
			DROP TABLE IF EXISTS files;
			DROP TABLE IF EXISTS meta;
		`);
		db.exec(SCHEMA_SQL);

		const tx = db.transaction(() => {
			const insertFn = db.prepare(
				"INSERT INTO functions (qualified_name, bare_name, file, line, exported, is_default, is_declaration_only, col, end_line, end_col) VALUES (?,?,?,?,?,?,?,?,?,?)",
			);
			const idByKey = new Map<string, number>();
			for (const f of graph.functions) {
				const info = insertFn.run(
					f.qualified_name,
					bareName(f.qualified_name),
					f.file,
					f.line,
					f.exported ? 1 : 0,
					f.is_default_export ? 1 : 0,
					f.is_declaration_only ? 1 : 0,
					f.col,
					f.end_line,
					f.end_col,
				);
				idByKey.set(`${f.file}::${f.qualified_name}`, Number(info.lastInsertRowid));
			}

			const insertCall = db.prepare(
				"INSERT INTO calls (from_id, to_id, to_bare_name, kind, site_line, site_col, site_end_line, site_end_col) VALUES (?,?,?,?,?,?,?,?)",
			);
			for (const c of graph.calls) {
				const fromId = idByKey.get(c.from_key);
				if (fromId === undefined) continue;
				const toId = c.to_key.startsWith("::")
					? null
					: (idByKey.get(c.to_key) ?? null);
				insertCall.run(
					fromId,
					toId,
					bareName(c.to_key),
					c.kind,
					c.site_line,
					c.site_col,
					c.site_end_line,
					c.site_end_col,
				);
			}

			const insertImport = db.prepare(
				"INSERT INTO imports (from_file, to_file) VALUES (?,?)",
			);
			for (const i of graph.imports) insertImport.run(i.from_path, i.to_path);

			const insertFile = db.prepare(
				"INSERT INTO files (path, kind, content_hash) VALUES (?,?,?)",
			);
			for (const f of graph.files)
				insertFile.run(f.path, f.kind, f.content_hash ?? null);

			const insertMeta = db.prepare(
				"INSERT INTO meta (key, value) VALUES (?,?)",
			);
			const now = new Date().toISOString();
			const rows: Array<[string, string]> = [
				["schema_version", String(CODE_NAV_SCHEMA_VERSION)],
				["source_fingerprint", meta.fingerprint],
				["source_indexed_at", meta.indexedAt],
				["ingested_at", now],
				["worktree_path", meta.worktreePath],
				["repo_key", meta.repoKey],
				["worktree_key", meta.worktreeKey],
				["dirty_at_index", meta.dirtyAtIndex ? "1" : "0"],
			];
			for (const [k, v] of rows) insertMeta.run(k, v);
		});
		tx();

		writeFileSync(
			sidecarPath,
			JSON.stringify(
				{
					schema_version: CODE_NAV_SCHEMA_VERSION,
					source_fingerprint: meta.fingerprint,
					ingested_at: new Date().toISOString(),
					functions_count: graph.functions.length,
				},
				null,
				2,
			),
		);

		return { skipped: false, functionsCount: graph.functions.length };
	} finally {
		db.close();
	}
}
