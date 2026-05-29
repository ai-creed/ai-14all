import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { CortexIndex } from "./cortex-json.js";
import { SCHEMA_SQL } from "./schema.js";

export const CODE_NAV_SCHEMA_VERSION = 1;

export interface IngestResult {
	skipped: boolean;
	functionsCount: number;
}

function bareName(qualified: string): string {
	const idx = qualified.lastIndexOf("::");
	return idx >= 0 ? qualified.slice(idx + 2) : qualified;
}

function parseCallTo(to: string): { file: string | null; name: string } {
	if (to.startsWith("::")) return { file: null, name: to.slice(2) };
	const idx = to.lastIndexOf("::");
	if (idx < 0) return { file: null, name: to };
	return { file: to.slice(0, idx), name: to.slice(idx + 2) };
}

export function ingestCortexJson(
	json: CortexIndex,
	dbPath: string,
): IngestResult {
	mkdirSync(dirname(dbPath), { recursive: true });
	const sidecarPath = dbPath.replace(/\.sqlite$/, ".meta.json");

	if (existsSync(dbPath) && existsSync(sidecarPath)) {
		try {
			const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as {
				source_fingerprint?: string;
				schema_version?: number;
				functions_count?: number;
			};
			if (
				sidecar.source_fingerprint === json.fingerprint &&
				sidecar.schema_version === CODE_NAV_SCHEMA_VERSION
			) {
				return { skipped: true, functionsCount: sidecar.functions_count ?? 0 };
			}
		} catch {
			// fall through and rebuild
		}
	}

	const db = new Database(dbPath);
	try {
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");
		db.exec(SCHEMA_SQL);

		const tx = db.transaction(() => {
			db.exec(
				"DELETE FROM calls; DELETE FROM functions; DELETE FROM imports; DELETE FROM files; DELETE FROM meta;",
			);

			const insertFn = db.prepare(
				"INSERT INTO functions (qualified_name, bare_name, file, line, exported, is_default, is_declaration_only) VALUES (?,?,?,?,?,?,?)",
			);
			const idByQualified = new Map<string, number>();
			for (const f of json.functions) {
				const info = insertFn.run(
					f.qualifiedName,
					bareName(f.qualifiedName),
					f.file,
					f.line,
					f.exported ? 1 : 0,
					f.isDefaultExport ? 1 : 0,
					f.isDeclarationOnly ? 1 : 0,
				);
				idByQualified.set(f.qualifiedName, Number(info.lastInsertRowid));
			}

			const insertCall = db.prepare(
				"INSERT INTO calls (from_id, to_id, to_bare_name, kind) VALUES (?,?,?,?)",
			);
			for (const c of json.calls) {
				const fromId = idByQualified.get(c.from);
				if (fromId === undefined) continue;
				const { file: toFile, name: toName } = parseCallTo(c.to);
				const toId = toFile
					? (idByQualified.get(`${toFile}::${toName}`) ?? null)
					: null;
				insertCall.run(fromId, toId, toName, c.kind);
			}

			const insertImport = db.prepare(
				"INSERT INTO imports (from_file, to_file) VALUES (?,?)",
			);
			for (const i of json.imports) insertImport.run(i.from, i.to);

			const insertFile = db.prepare(
				"INSERT INTO files (path, kind, content_hash) VALUES (?,?,?)",
			);
			for (const f of json.files)
				insertFile.run(f.path, f.kind, f.contentHash ?? null);

			const insertMeta = db.prepare(
				"INSERT INTO meta (key, value) VALUES (?,?)",
			);
			const now = new Date().toISOString();
			const rows: Array<[string, string]> = [
				["schema_version", String(CODE_NAV_SCHEMA_VERSION)],
				["source_fingerprint", json.fingerprint],
				["source_indexed_at", json.indexedAt],
				["ingested_at", now],
				["worktree_path", json.worktreePath],
				["repo_key", json.repoKey],
				["worktree_key", json.worktreeKey],
				["dirty_at_index", json.dirtyAtIndex ? "1" : "0"],
			];
			for (const [k, v] of rows) insertMeta.run(k, v);
		});
		tx();

		writeFileSync(
			sidecarPath,
			JSON.stringify(
				{
					schema_version: CODE_NAV_SCHEMA_VERSION,
					source_fingerprint: json.fingerprint,
					ingested_at: new Date().toISOString(),
					functions_count: json.functions.length,
				},
				null,
				2,
			),
		);

		return { skipped: false, functionsCount: json.functions.length };
	} finally {
		db.close();
	}
}
