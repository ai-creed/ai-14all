import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { rankDefinitions, type DefinitionRow } from "./ranking.js";

export interface WorktreeKeys {
	worktreePath: string;
	repoKey: string;
	worktreeKey: string;
}

export interface CortexIndexServiceOptions {
	cacheRoot: string;
	handleIdleMs?: number;
}

export interface WorktreeStatus {
	ready: boolean;
	dirtyAtIndex: boolean;
	sourceFingerprint: string | null;
	sourceIndexedAt: string | null;
}

interface Handle {
	db: Database.Database;
	lastUsed: number;
}

export class CortexIndexNotReadyError extends Error {
	constructor(public readonly keys: WorktreeKeys) {
		super(
			`Cortex SQLite mirror missing for ${keys.repoKey}/${keys.worktreeKey}`,
		);
		this.name = "CortexIndexNotReadyError";
	}
}

function buildFtsMatch(query: string): string {
	const tokens = query.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return "";
	return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

export class CortexIndexService {
	private handles = new Map<string, Handle>();
	private readonly idleMs: number;

	constructor(private readonly opts: CortexIndexServiceOptions) {
		this.idleMs = opts.handleIdleMs ?? 60_000;
	}

	dbPathForKeys(repoKey: string, worktreeKey: string): string {
		return join(this.opts.cacheRoot, repoKey, `${worktreeKey}.sqlite`);
	}

	private open(keys: WorktreeKeys): Database.Database {
		const k = `${keys.repoKey}/${keys.worktreeKey}`;
		const existing = this.handles.get(k);
		if (existing) {
			existing.lastUsed = Date.now();
			return existing.db;
		}
		const path = this.dbPathForKeys(keys.repoKey, keys.worktreeKey);
		if (!existsSync(path)) throw new CortexIndexNotReadyError(keys);
		const db = new Database(path, { readonly: true, fileMustExist: true });
		db.pragma("query_only = ON");
		this.handles.set(k, { db, lastUsed: Date.now() });
		return db;
	}

	closeIdle(now = Date.now()): void {
		for (const [k, h] of this.handles) {
			if (now - h.lastUsed > this.idleMs) {
				h.db.close();
				this.handles.delete(k);
			}
		}
	}

	dispose(): void {
		for (const h of this.handles.values()) h.db.close();
		this.handles.clear();
	}

	invalidate(keys: WorktreeKeys): void {
		const k = `${keys.repoKey}/${keys.worktreeKey}`;
		const h = this.handles.get(k);
		if (h) {
			h.db.close();
			this.handles.delete(k);
		}
	}

	findDefinitions(
		keys: WorktreeKeys,
		q: { name: string; callerFile?: string },
	): DefinitionRow[] {
		const db = this.open(keys);
		const rows = db
			.prepare(
				"SELECT * FROM functions WHERE bare_name = ? OR qualified_name = ?",
			)
			.all(q.name, q.name) as DefinitionRow[];

		const importedFiles = new Set<string>();
		if (q.callerFile) {
			const imps = db
				.prepare("SELECT to_file FROM imports WHERE from_file = ?")
				.all(q.callerFile) as Array<{ to_file: string }>;
			for (const r of imps) importedFiles.add(r.to_file);
		}
		return rankDefinitions(rows, {
			query: q.name,
			callerFile: q.callerFile,
			importedFiles,
		});
	}

	findCallees(keys: WorktreeKeys, q: { fnId: number }): DefinitionRow[] {
		const db = this.open(keys);
		return db
			.prepare(
				"SELECT f.* FROM calls c JOIN functions f ON c.to_id = f.id WHERE c.from_id = ?",
			)
			.all(q.fnId) as DefinitionRow[];
	}

	findCallers(keys: WorktreeKeys, q: { fnId: number }): DefinitionRow[] {
		const db = this.open(keys);
		const direct = db
			.prepare(
				"SELECT f.* FROM calls c JOIN functions f ON c.from_id = f.id WHERE c.to_id = ?",
			)
			.all(q.fnId) as DefinitionRow[];
		const def = db
			.prepare("SELECT bare_name FROM functions WHERE id = ?")
			.get(q.fnId) as { bare_name: string } | undefined;
		if (!def) return direct;
		const bareCallers = db
			.prepare(
				"SELECT f.* FROM calls c JOIN functions f ON c.from_id = f.id WHERE c.to_id IS NULL AND c.to_bare_name = ?",
			)
			.all(def.bare_name) as DefinitionRow[];
		const seen = new Set(direct.map((d) => d.id));
		return [...direct, ...bareCallers.filter((r) => !seen.has(r.id))];
	}

	searchSymbols(
		keys: WorktreeKeys,
		q: { query: string; limit: number },
	): DefinitionRow[] {
		const db = this.open(keys);
		const match = buildFtsMatch(q.query);
		if (!match) {
			return db
				.prepare(
					"SELECT * FROM functions ORDER BY qualified_name COLLATE NOCASE LIMIT ?",
				)
				.all(q.limit) as DefinitionRow[];
		}
		return db
			.prepare(
				"SELECT f.* FROM functions_fts JOIN functions f ON f.id = functions_fts.rowid WHERE functions_fts MATCH ? ORDER BY rank LIMIT ?",
			)
			.all(match, q.limit) as DefinitionRow[];
	}

	getFileImports(keys: WorktreeKeys, q: { file: string }): string[] {
		const db = this.open(keys);
		const rows = db
			.prepare("SELECT to_file FROM imports WHERE from_file = ?")
			.all(q.file) as Array<{ to_file: string }>;
		return rows.map((r) => r.to_file);
	}

	getWorktreeStatus(keys: WorktreeKeys): WorktreeStatus {
		const db = this.open(keys);
		const get = (k: string): string | undefined =>
			(
				db.prepare("SELECT value FROM meta WHERE key = ?").get(k) as
					| { value: string }
					| undefined
			)?.value;
		return {
			ready: true,
			dirtyAtIndex: get("dirty_at_index") === "1",
			sourceFingerprint: get("source_fingerprint") ?? null,
			sourceIndexedAt: get("source_indexed_at") ?? null,
		};
	}

	listFiles(keys: WorktreeKeys): string[] {
		const db = this.open(keys);
		return (
			db
				.prepare("SELECT path FROM files WHERE kind = 'file' ORDER BY path")
				.all() as Array<{ path: string }>
		).map((r) => r.path);
	}
}
