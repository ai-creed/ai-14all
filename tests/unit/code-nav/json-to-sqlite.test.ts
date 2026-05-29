import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CODE_NAV_SCHEMA_VERSION,
	ingestCortexJson,
} from "../../../electron/code-nav/ingest/json-to-sqlite.js";

const FIXTURE = resolve(
	process.cwd(),
	"electron/code-nav/ingest/__fixtures__/cortex-tiny.json",
);

describe("ingestCortexJson", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "code-nav-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("creates a SQLite DB and ingests functions, calls, imports, files", () => {
		const dbPath = join(dir, "wt1.sqlite");
		const json = JSON.parse(readFileSync(FIXTURE, "utf8"));

		const result = ingestCortexJson(json, dbPath);

		expect(result.skipped).toBe(false);
		const db = new Database(dbPath, { readonly: true });
		expect(db.prepare("SELECT COUNT(*) c FROM functions").get()).toEqual({
			c: 3,
		});
		expect(db.prepare("SELECT COUNT(*) c FROM calls").get()).toEqual({ c: 2 });
		expect(db.prepare("SELECT COUNT(*) c FROM imports").get()).toEqual({
			c: 1,
		});
		expect(db.prepare("SELECT COUNT(*) c FROM files").get()).toEqual({ c: 2 });
		expect(
			db.prepare("SELECT value FROM meta WHERE key='schema_version'").get(),
		).toEqual({ value: String(CODE_NAV_SCHEMA_VERSION) });
		expect(
			db.prepare("SELECT value FROM meta WHERE key='source_fingerprint'").get(),
		).toEqual({ value: "abc123" });
		expect(
			db.prepare("SELECT value FROM meta WHERE key='dirty_at_index'").get(),
		).toEqual({ value: "0" });
		db.close();
	});

	it('resolves call.to "file::func" to to_id, NULL for "::bareName"', () => {
		const dbPath = join(dir, "wt1.sqlite");
		const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
		ingestCortexJson(json, dbPath);
		const db = new Database(dbPath, { readonly: true });
		const rows = db
			.prepare("SELECT to_id, to_bare_name FROM calls ORDER BY id")
			.all() as Array<{ to_id: number | null; to_bare_name: string }>;
		expect(rows[0].to_id).not.toBeNull();
		expect(rows[0].to_bare_name).toBe("parseConfig");
		expect(rows[1].to_id).toBeNull();
		expect(rows[1].to_bare_name).toBe("unknownHelper");
		db.close();
	});

	it("skips ingest when fingerprint and schema_version match", () => {
		const dbPath = join(dir, "wt1.sqlite");
		const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
		ingestCortexJson(json, dbPath);
		const second = ingestCortexJson(json, dbPath);
		expect(second.skipped).toBe(true);
	});

	it("re-ingests when fingerprint differs", () => {
		const dbPath = join(dir, "wt1.sqlite");
		const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
		ingestCortexJson(json, dbPath);
		const second = ingestCortexJson({ ...json, fingerprint: "v2" }, dbPath);
		expect(second.skipped).toBe(false);
	});
});
