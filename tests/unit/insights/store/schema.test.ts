import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	DDL_V1,
	migrate,
	TARGET_SCHEMA_VERSION,
} from "../../../../services/insights/store/schema.js";
import { APP_FOCUS_SOURCE } from "../../../../services/insights/app-focus/span-observation.js";

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

	// Named indexes only: the TEXT PRIMARY KEY also creates
	// sqlite_autoindex_observations_1, which is noise for these assertions.
	const indexes = (db: Database.Database) =>
		db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='observations' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name",
			)
			.all()
			.map((r) => (r as { name: string }).name);

	it("fresh migrate lands at v3: span + anchor indexes added, v1+v2 set intact", () => {
		const db = new Database(":memory:");
		migrate(db);
		expect(db.pragma("user_version", { simple: true })).toBe(3);
		// AC4: the full named-index set — v3 must never drop or rename a v1/v2 index.
		expect(indexes(db)).toEqual([
			"idx_obs_kind_occstart",
			"idx_obs_kind_ts",
			"idx_obs_source_ts",
			"idx_obs_span",
			"idx_obs_subject",
			"idx_obs_ts",
		]);
	});

	it("upgrades a hand-built v1 store in place: indexes added, rows preserved", () => {
		const db = new Database(":memory:");
		// A store exactly as v1-era migrate() left it: frozen v1 DDL + user_version 1.
		db.transaction(() => {
			db.exec(DDL_V1);
			db.pragma("user_version = 1");
		})();
		db.prepare(
			"INSERT INTO observations (event_id, kind, source, ts_precision, parser_version, schema_version, ingested_at, payload) VALUES ('e1','whisper.workflow','whisper-archiver','exact',1,7,1,'{}')",
		).run();
		migrate(db);
		expect(db.pragma("user_version", { simple: true })).toBe(3);
		expect(indexes(db)).toEqual([
			"idx_obs_kind_occstart",
			"idx_obs_kind_ts",
			"idx_obs_source_ts",
			"idx_obs_span",
			"idx_obs_subject",
			"idx_obs_ts",
		]);
		expect(db.prepare("SELECT COUNT(*) c FROM observations").get()).toEqual({
			c: 1,
		});
		// Idempotent at v3 (also proves a resumed/re-run migrate is safe):
		expect(() => migrate(db)).not.toThrow();
		expect(db.pragma("user_version", { simple: true })).toBe(3);
	});

	it("the retention DELETE uses idx_obs_ts, never a full scan (E1 regression guard)", () => {
		const db = new Database(":memory:");
		migrate(db);
		const plan = db
			.prepare("EXPLAIN QUERY PLAN DELETE FROM observations WHERE event_ts < ?")
			.all(0)
			.map((r) => (r as { detail: string }).detail)
			.join(" | ");
		expect(plan).toContain("USING INDEX idx_obs_ts");
		expect(plan).not.toMatch(/\bSCAN\b/);
	});

	it("fresh migrate lands at v3: span + anchor indexes added, v1+v2 set intact", () => {
		const db = new Database(":memory:");
		migrate(db);
		expect(db.pragma("user_version", { simple: true })).toBe(3);
		expect(indexes(db)).toEqual([
			"idx_obs_kind_occstart",
			"idx_obs_kind_ts",
			"idx_obs_source_ts",
			"idx_obs_span",
			"idx_obs_subject",
			"idx_obs_ts",
		]);
	});

	it("upgrades a v2 store in place: rows preserved, idempotent at v3", () => {
		const db = new Database(":memory:");
		db.transaction(() => {
			db.exec(DDL_V1);
			db.pragma("user_version = 1");
			db.exec("CREATE INDEX idx_obs_ts ON observations (event_ts)");
			db.pragma("user_version = 2");
		})();
		db.prepare(
			"INSERT INTO observations (event_id, kind, source, ts_precision, parser_version, schema_version, ingested_at, payload) VALUES ('e1','app.focused',?, 'exact',1,7,1,'{}')",
		).run(APP_FOCUS_SOURCE);
		migrate(db);
		expect(db.pragma("user_version", { simple: true })).toBe(3);
		expect(db.prepare("SELECT COUNT(*) c FROM observations").get()).toEqual({ c: 1 });
		expect(() => migrate(db)).not.toThrow();
		expect(db.pragma("user_version", { simple: true })).toBe(3);
	});

	it("span overlap query uses idx_obs_span, never a full scan (AC8)", () => {
		const db = new Database(":memory:");
		migrate(db);
		const plan = db
			.prepare(
				"EXPLAIN QUERY PLAN SELECT occurred_start, occurred_end FROM observations WHERE kind = ? AND source = ? AND occurred_end > ? AND occurred_start < ?",
			)
			.all("app.focused", APP_FOCUS_SOURCE, 0, 1)
			.map((r) => (r as { detail: string }).detail)
			.join(" | ");
		expect(plan).toContain("idx_obs_span");
		expect(plan).not.toMatch(/\bSCAN\b/);
	});

	it("anchor MIN(occurred_start) uses idx_obs_kind_occstart, never a full scan (AC8)", () => {
		const db = new Database(":memory:");
		migrate(db);
		const plan = db
			.prepare(
				"EXPLAIN QUERY PLAN SELECT MIN(occurred_start) FROM observations WHERE kind = ?",
			)
			.all("app.uptime")
			.map((r) => (r as { detail: string }).detail)
			.join(" | ");
		expect(plan).toContain("idx_obs_kind_occstart");
		expect(plan).not.toMatch(/\bSCAN\b/);
	});
});
