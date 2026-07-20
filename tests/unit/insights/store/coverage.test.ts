import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../../../services/insights/store/schema.js";
import {
	getCompleteness,
	markCoverage,
} from "../../../../services/insights/store/coverage.js";

const fresh = () => {
	const db = new Database(":memory:");
	migrate(db);
	return db;
};

describe("coverage", () => {
	it("upsert is idempotent for (source,'n/a',day)", () => {
		const db = fresh();
		markCoverage(db, {
			source: "whisper-archiver",
			day: "2026-07-19",
			complete: true,
		});
		markCoverage(db, {
			source: "whisper-archiver",
			day: "2026-07-19",
			complete: true,
		});
		expect(db.prepare("SELECT COUNT(*) c FROM coverage").get()).toEqual({
			c: 1,
		});
	});

	it("reports complete/partial/unknown", () => {
		const db = fresh();
		markCoverage(db, {
			source: "whisper-archiver",
			day: "2026-07-19",
			complete: true,
		});
		expect(getCompleteness(db, "whisper-archiver", ["2026-07-19"])).toBe(
			"complete",
		);
		expect(
			getCompleteness(db, "whisper-archiver", ["2026-07-19", "2026-07-20"]),
		).toBe("partial");
		expect(getCompleteness(db, "whisper-archiver", ["2026-07-21"])).toBe(
			"unknown",
		);
	});
});
