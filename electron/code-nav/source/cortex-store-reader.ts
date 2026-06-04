import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type {
	CortexCallRow,
	CortexFileRow,
	CortexFunctionRow,
	CortexGraph,
	CortexImportRow,
	CortexStoreMeta,
} from "../ingest/cortex-store.js";

/** Sole owner of ai-cortex's v3.1 `.db` schema knowledge. Read-only. */
export class CortexStoreReader {
	constructor(private readonly cortexDbPath: string) {}

	private open(): Database.Database | null {
		if (!existsSync(this.cortexDbPath)) return null;
		try {
			const db = new Database(this.cortexDbPath, {
				readonly: true,
				fileMustExist: true,
			});
			db.pragma("busy_timeout = 2000");
			return db;
		} catch {
			return null;
		}
	}

	readMeta(): CortexStoreMeta | null {
		const db = this.open();
		if (!db) return null;
		try {
			const get = (k: string): string | undefined =>
				(
					db.prepare("SELECT value FROM meta WHERE key = ?").get(k) as
						| { value: string }
						| undefined
				)?.value;
			const schemaVersion = get("schemaVersion");
			const fingerprint = get("fingerprint");
			const indexedAt = get("indexedAt");
			if (
				schemaVersion === undefined ||
				fingerprint === undefined ||
				indexedAt === undefined
			)
				return null;
			const dirty = get("dirtyAtIndex");
			return {
				schemaVersion,
				fingerprint,
				indexedAt,
				dirtyAtIndex: dirty === "1" || dirty === "true",
				repoKey: get("repoKey") ?? "",
				worktreeKey: get("worktreeKey") ?? "",
				worktreePath: get("worktreePath") ?? "",
			};
		} catch {
			return null;
		} finally {
			db.close();
		}
	}

	readGraph(): CortexGraph {
		const db = this.open();
		if (!db) return { functions: [], calls: [], imports: [], files: [] };
		try {
			const functions = db
				.prepare(
					"SELECT qualified_name, file, line, col, end_line, end_col, exported, is_default_export, is_declaration_only FROM functions",
				)
				.all() as CortexFunctionRow[];
			const calls = db
				.prepare(
					"SELECT from_key, to_key, kind, site_line, site_col, site_end_line, site_end_col FROM calls",
				)
				.all() as CortexCallRow[];
			const imports = db
				.prepare("SELECT from_path, to_path FROM imports")
				.all() as CortexImportRow[];
			const files = db
				.prepare("SELECT path, kind, content_hash FROM files")
				.all() as CortexFileRow[];
			return { functions, calls, imports, files };
		} finally {
			db.close();
		}
	}
}
