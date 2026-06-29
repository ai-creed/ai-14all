// tests/unit/review/review-progress.test.ts
import { describe, expect, it } from "vitest";
import {
	computeReviewProgress,
	reviewedChangedPaths,
	reviewedPathsAmong,
} from "../../../src/features/review/logic/review-progress";
import type { GitChange } from "../../../shared/models/git-change";
import type { ReviewedFileMark } from "../../../shared/models/reviewed-file";

const changes: GitChange[] = [
	{ path: "a.ts", status: "M" },
	{ path: "b.ts", status: "M" },
	{ path: "c.ts", status: "A" },
];

describe("review-progress", () => {
	it("counts a mark with a matching loaded hash as reviewed", () => {
		const marks: ReviewedFileMark[] = [{ filePath: "a.ts", contentHash: "1" }];
		const progress = computeReviewProgress(changes, marks, { "a.ts": "1" });
		expect(progress).toEqual({ reviewed: 1, total: 3 });
	});

	it("does NOT count a mark whose loaded hash no longer matches", () => {
		const marks: ReviewedFileMark[] = [{ filePath: "a.ts", contentHash: "1" }];
		expect(reviewedChangedPaths(changes, marks, { "a.ts": "2" })).toEqual([]);
	});

	it("trusts a persisted mark when the content has not been loaded yet", () => {
		const marks: ReviewedFileMark[] = [{ filePath: "b.ts", contentHash: "x" }];
		expect(reviewedChangedPaths(changes, marks, {})).toEqual(["b.ts"]);
	});

	it("ignores marks for files no longer in the change set", () => {
		const marks: ReviewedFileMark[] = [
			{ filePath: "gone.ts", contentHash: "z" },
		];
		expect(computeReviewProgress(changes, marks, {})).toEqual({
			reviewed: 0,
			total: 3,
		});
	});

	it("total is the change count; empty changes → 0/0", () => {
		expect(computeReviewProgress([], [], {})).toEqual({ reviewed: 0, total: 0 });
	});

	it("reviewedPathsAmong applies the same rule to an arbitrary path list (commit files)", () => {
		const marks: ReviewedFileMark[] = [{ filePath: "x.ts", contentHash: "h" }];
		expect(reviewedPathsAmong(["x.ts", "y.ts"], marks, { "x.ts": "h" })).toEqual(["x.ts"]);
		expect(reviewedPathsAmong(["x.ts"], marks, { "x.ts": "stale" })).toEqual([]);
	});
});
