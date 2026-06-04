import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "../../../electron/code-nav/ingest/schema.js";

describe("mirror schema", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "schema-cols-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	function columns(db: Database.Database, table: string): string[] {
		return (
			db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
		).map((r) => r.name);
	}

	it("functions carries nullable range columns; calls carries site columns", () => {
		const db = new Database(join(dir, "m.sqlite"));
		db.exec(SCHEMA_SQL);
		expect(columns(db, "functions")).toEqual(
			expect.arrayContaining(["col", "end_line", "end_col"]),
		);
		expect(columns(db, "calls")).toEqual(
			expect.arrayContaining([
				"site_line",
				"site_col",
				"site_end_line",
				"site_end_col",
			]),
		);
		db.close();
	});
});
