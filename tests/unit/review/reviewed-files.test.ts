// tests/unit/review/reviewed-files.test.ts
import { describe, expect, it } from "vitest";
import {
	isFileReviewed,
	removeReviewedMark,
	upsertReviewedMark,
} from "../../../src/features/review/logic/reviewed-files";
import type { ReviewedFileMark } from "../../../shared/models/reviewed-file";

const marks: ReviewedFileMark[] = [{ filePath: "a.ts", contentHash: "1111" }];

describe("reviewed-files helpers", () => {
	it("isFileReviewed is true only when path + hash both match", () => {
		expect(isFileReviewed(marks, "a.ts", "1111")).toBe(true);
		expect(isFileReviewed(marks, "a.ts", "2222")).toBe(false);
		expect(isFileReviewed(marks, "b.ts", "1111")).toBe(false);
	});

	it("upsert adds a new mark", () => {
		const next = upsertReviewedMark(marks, "b.ts", "3333");
		expect(next).toHaveLength(2);
		expect(isFileReviewed(next, "b.ts", "3333")).toBe(true);
	});

	it("upsert replaces the hash for an existing path (no duplicates)", () => {
		const next = upsertReviewedMark(marks, "a.ts", "9999");
		expect(next).toHaveLength(1);
		expect(isFileReviewed(next, "a.ts", "9999")).toBe(true);
		expect(isFileReviewed(next, "a.ts", "1111")).toBe(false);
	});

	it("remove drops the mark for a path", () => {
		expect(removeReviewedMark(marks, "a.ts")).toHaveLength(0);
		expect(removeReviewedMark(marks, "missing.ts")).toHaveLength(1);
	});

	it("does not mutate the input array", () => {
		upsertReviewedMark(marks, "c.ts", "4444");
		expect(marks).toHaveLength(1);
	});
});
