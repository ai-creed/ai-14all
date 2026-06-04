import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CODE_NAV_SCHEMA_VERSION,
	ingestCortexStore,
} from "../../../electron/code-nav/ingest/cortex-store-to-mirror.js";
import { makeCortexFixtureDb } from "./helpers/make-cortex-fixture-db.js";

describe("ingestCortexStore", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "store-to-mirror-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	function fixture(): string {
		const p = join(dir, "wtA.db");
		makeCortexFixtureDb(p, {
			meta: { fingerprint: "fp1" },
			functions: [
				{ qualified_name: "parseConfig", file: "src/utils.ts", line: 10, col: 1, end_line: 12, end_col: 1, exported: 1 },
				{ qualified_name: "render", file: "src/page.ts", line: 5, exported: 1 },
				{ qualified_name: "Cli::parse", file: "src/utils.ts", line: 40, is_declaration_only: 1 },
			],
			calls: [
				{ from_key: "src/page.ts::render", to_key: "src/utils.ts::parseConfig", kind: "call", site_line: 6, site_col: 3 },
				{ from_key: "src/page.ts::render", to_key: "::unknownHelper", kind: "call", site_line: 7, site_col: 3 },
				{ from_key: "src/utils.ts::Cli::parse", to_key: "::Set", kind: "new" },
			],
			imports: [{ from_path: "src/page.ts", to_path: "src/utils.ts" }],
			files: [
				{ path: "src/page.ts", kind: "file" },
				{ path: "src/utils.ts", kind: "file" },
			],
		});
		return p;
	}

	it("ingests functions/calls/imports/files and meta", () => {
		const cortexDb = fixture();
		const mirror = join(dir, "mirror.sqlite");
		const result = ingestCortexStore(cortexDb, mirror);
		expect(result).toMatchObject({ skipped: false, functionsCount: 3 });
		const db = new Database(mirror, { readonly: true });
		expect(db.prepare("SELECT COUNT(*) c FROM functions").get()).toEqual({ c: 3 });
		expect(db.prepare("SELECT COUNT(*) c FROM calls").get()).toEqual({ c: 3 });
		expect(db.prepare("SELECT COUNT(*) c FROM imports").get()).toEqual({ c: 1 });
		expect(db.prepare("SELECT COUNT(*) c FROM files").get()).toEqual({ c: 2 });
		expect(
			db.prepare("SELECT value FROM meta WHERE key='schema_version'").get(),
		).toEqual({ value: String(CODE_NAV_SCHEMA_VERSION) });
		expect(
			db.prepare("SELECT value FROM meta WHERE key='source_fingerprint'").get(),
		).toEqual({ value: "fp1" });
		db.close();
	});

	it("derives bare_name (incl. nested) and carries function ranges", () => {
		const db = new Database(ingestTo(fixture(), dir), { readonly: true });
		const cli = db
			.prepare("SELECT bare_name, col, end_line FROM functions WHERE qualified_name='Cli::parse'")
			.get() as { bare_name: string; col: number | null; end_line: number | null };
		expect(cli.bare_name).toBe("parse");
		const pc = db
			.prepare("SELECT bare_name, col, end_line, end_col FROM functions WHERE qualified_name='parseConfig'")
			.get() as { bare_name: string; col: number; end_line: number; end_col: number };
		expect(pc).toMatchObject({ bare_name: "parseConfig", col: 1, end_line: 12, end_col: 1 });
		db.close();
	});

	it("resolves calls by full key; unresolved '::x' → null to_id; sites carried", () => {
		const db = new Database(ingestTo(fixture(), dir), { readonly: true });
		const rows = db
			.prepare("SELECT to_id, to_bare_name, site_line FROM calls ORDER BY id")
			.all() as Array<{ to_id: number | null; to_bare_name: string; site_line: number | null }>;
		expect(rows[0].to_id).not.toBeNull();
		expect(rows[0].to_bare_name).toBe("parseConfig");
		expect(rows[0].site_line).toBe(6);
		expect(rows[1].to_id).toBeNull();
		expect(rows[1].to_bare_name).toBe("unknownHelper");
		expect(rows[2].to_bare_name).toBe("Set");
		db.close();
	});

	it("skips when fingerprint and schema_version match; re-ingests when fingerprint differs", () => {
		const cortexDb = fixture();
		const mirror = join(dir, "mirror.sqlite");
		ingestCortexStore(cortexDb, mirror);
		expect(ingestCortexStore(cortexDb, mirror)).toMatchObject({ skipped: true });
		makeCortexFixtureDb(cortexDb, { meta: { fingerprint: "fp2" }, functions: [{ qualified_name: "x", file: "x.ts", line: 1 }] });
		expect(ingestCortexStore(cortexDb, mirror)).toMatchObject({ skipped: false });
	});

	it("returns no-store when the cortex .db is missing", () => {
		const result = ingestCortexStore(join(dir, "missing.db"), join(dir, "m.sqlite"));
		expect(result).toEqual({ unavailable: true, reason: "no-store" });
	});

	it("rejects schemaVersion 3.0 and 4.0; accepts 3.1", () => {
		const lo = join(dir, "lo.db");
		makeCortexFixtureDb(lo, { meta: { schemaVersion: "3.0" }, functions: [{ qualified_name: "a", file: "a.ts", line: 1 }] });
		expect(ingestCortexStore(lo, join(dir, "lo.sqlite"))).toEqual({
			unavailable: true,
			reason: "unsupported-schema",
			schemaVersion: "3.0",
		});

		const hi = join(dir, "hi.db");
		makeCortexFixtureDb(hi, { meta: { schemaVersion: "4.0" }, functions: [{ qualified_name: "a", file: "a.ts", line: 1 }] });
		expect(ingestCortexStore(hi, join(dir, "hi.sqlite"))).toMatchObject({
			unavailable: true,
			reason: "unsupported-schema",
		});

		const ok = join(dir, "ok.db");
		makeCortexFixtureDb(ok, { meta: { schemaVersion: "3.1" }, functions: [{ qualified_name: "a", file: "a.ts", line: 1 }] });
		expect(ingestCortexStore(ok, join(dir, "ok.sqlite"))).toMatchObject({ skipped: false });
	});
});

// Helper: ingest the given cortex db into a fresh mirror path and return it.
function ingestTo(cortexDb: string, dir: string): string {
	const mirror = join(dir, `mirror-${Math.abs(hash(cortexDb))}.sqlite`);
	ingestCortexStore(cortexDb, mirror);
	return mirror;
}
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return h;
}
