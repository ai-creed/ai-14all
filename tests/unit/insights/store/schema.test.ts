import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	migrate,
	TARGET_SCHEMA_VERSION,
} from "../../../../services/insights/store/schema.js";

const tables = (db: Database.Database) =>
	db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
		)
		.all()
		.map((r) => (r as { name: string }).name);

describe("insights schema migrate", () => {
	it("creates v1 with all three tables + the view and pins user_version", () => {
		const db = new Database(":memory:");
		migrate(db);
		expect(db.pragma("user_version", { simple: true })).toBe(
			TARGET_SCHEMA_VERSION,
		);
		expect(tables(db)).toEqual(
			expect.arrayContaining([
				"coverage",
				"meta",
				"observations",
				"whisper_runs",
			]),
		);
	});

	it("is idempotent (second run is a no-op)", () => {
		const db = new Database(":memory:");
		migrate(db);
		expect(() => migrate(db)).not.toThrow();
		expect(db.pragma("user_version", { simple: true })).toBe(
			TARGET_SCHEMA_VERSION,
		);
	});

	it("meta survives a reopen of the same file", () => {
		const path = `${process.env.TMPDIR ?? "/tmp"}/insights-schema-${process.pid}.db`;
		const a = new Database(path);
		migrate(a);
		a.prepare(
			"INSERT INTO meta(key,value) VALUES('first_capture_at','123')",
		).run();
		a.close();
		const b = new Database(path);
		expect(
			b.prepare("SELECT value FROM meta WHERE key='first_capture_at'").get(),
		).toEqual({ value: "123" });
		b.close();
	});
});
