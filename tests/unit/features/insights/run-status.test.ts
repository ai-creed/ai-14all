import { describe, it, expect } from "vitest";
import {
	countRunOutcomes,
	emptyRunCounts,
	groupRunsByRepo,
	projectRunStatus,
	runsBreakdownLabel,
} from "../../../../src/features/insights/runStatus";

describe("projectRunStatus", () => {
	it("total projection: every known status + unknown maps per the spec table", () => {
		expect(projectRunStatus("done")).toBe("done");
		expect(projectRunStatus("halted")).toBe("halted");
		expect(projectRunStatus("canceled")).toBe("halted");
		expect(projectRunStatus("failed")).toBe("failed");
		expect(projectRunStatus("running")).toBe("active");
		expect(projectRunStatus("paused")).toBe("active");
		expect(projectRunStatus("archived-v2")).toBe("other");
	});
});

describe("emptyRunCounts", () => {
	it("returns all-zero counts for every outcome class", () => {
		expect(emptyRunCounts()).toEqual({
			done: 0,
			halted: 0,
			failed: 0,
			active: 0,
			other: 0,
		});
	});
});

describe("countRunOutcomes", () => {
	it("drops nothing: sum of classes equals seeded count", () => {
		const c = countRunOutcomes([
			"done",
			"halted",
			"failed",
			"running",
			"paused",
			"canceled",
			"archived-v2",
		]);
		expect(c).toEqual({ done: 1, halted: 2, failed: 1, active: 2, other: 1 });
		expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(7);
	});

	it("empty input yields all-zero counts", () => {
		expect(countRunOutcomes([])).toEqual(emptyRunCounts());
	});
});

describe("groupRunsByRepo", () => {
	it("groups by repoId, including the null (unattributed) key, and never drops a run", () => {
		const runs = [
			{ repoId: "repo-a", status: "done" },
			{ repoId: "repo-a", status: "failed" },
			{ repoId: "repo-b", status: "running" },
			{ repoId: null, status: "canceled" },
		];
		const groups = groupRunsByRepo(runs);
		expect(groups.get("repo-a")).toEqual({
			done: 1,
			halted: 0,
			failed: 1,
			active: 0,
			other: 0,
		});
		expect(groups.get("repo-b")).toEqual({
			done: 0,
			halted: 0,
			failed: 0,
			active: 1,
			other: 0,
		});
		expect(groups.get(null)).toEqual({
			done: 0,
			halted: 1,
			failed: 0,
			active: 0,
			other: 0,
		});
		const total = [...groups.values()].reduce(
			(a, c) => a + Object.values(c).reduce((x, y) => x + y, 0),
			0,
		);
		expect(total).toBe(runs.length);
	});
});

describe("runsBreakdownLabel", () => {
	it("appends active/other ONLY when non-zero", () => {
		expect(
			runsBreakdownLabel({
				done: 2,
				halted: 1,
				failed: 0,
				active: 0,
				other: 0,
			}),
		).toBe("2 done · 1 halted · 0 failed");
		expect(
			runsBreakdownLabel({
				done: 2,
				halted: 1,
				failed: 0,
				active: 3,
				other: 1,
			}),
		).toBe("2 done · 1 halted · 0 failed · 3 active · 1 other");
	});

	it("appends only active when other is zero, and vice versa", () => {
		expect(
			runsBreakdownLabel({
				done: 1,
				halted: 0,
				failed: 0,
				active: 2,
				other: 0,
			}),
		).toBe("1 done · 0 halted · 0 failed · 2 active");
		expect(
			runsBreakdownLabel({
				done: 1,
				halted: 0,
				failed: 0,
				active: 0,
				other: 4,
			}),
		).toBe("1 done · 0 halted · 0 failed · 4 other");
	});
});
