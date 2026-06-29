import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useReviewedFiles } from "../../../src/features/review/hooks/use-reviewed-files";
import { hashContent } from "../../../src/features/review/logic/content-hash";
import type { ReviewedFileMark } from "../../../shared/models/reviewed-file";

describe("useReviewedFiles", () => {
	it("isReviewed is true only when a recorded hash matches an existing mark", () => {
		const dispatch = vi.fn();
		const marks: ReviewedFileMark[] = [
			{ filePath: "a.ts", contentHash: hashContent("v1") },
		];
		const { result } = renderHook(() =>
			useReviewedFiles({ worktreeId: "wt1", marks, dispatch }),
		);
		expect(result.current.isReviewed("a.ts")).toBe(false); // hash not recorded yet
		act(() => result.current.recordHash("a.ts", "v1"));
		expect(result.current.isReviewed("a.ts")).toBe(true);
		act(() => result.current.recordHash("a.ts", "v2")); // content changed
		expect(result.current.isReviewed("a.ts")).toBe(false); // mark no longer matches
	});

	it("reviewedPaths / progress trust a persisted mark until its content is loaded", () => {
		const dispatch = vi.fn();
		const marks: ReviewedFileMark[] = [{ filePath: "a.ts", contentHash: "h" }];
		const { result } = renderHook(() =>
			useReviewedFiles({ worktreeId: "wt1", marks, dispatch }),
		);
		expect(result.current.reviewedPaths(["a.ts", "b.ts"])).toEqual(["a.ts"]);
		expect(result.current.progress(["a.ts", "b.ts"])).toEqual({ reviewed: 1, total: 2 });
		act(() => result.current.recordHash("a.ts", "different")); // hash now known + stale
		expect(result.current.reviewedPaths(["a.ts", "b.ts"])).toEqual([]);
	});

	it("toggleViewed marks when unmarked and unmarks when already marked", () => {
		const dispatch = vi.fn();
		const { result, rerender } = renderHook(
			({ marks }: { marks: ReviewedFileMark[] }) =>
				useReviewedFiles({ worktreeId: "wt1", marks, dispatch }),
			{ initialProps: { marks: [] as ReviewedFileMark[] } },
		);
		act(() => result.current.toggleViewed("a.ts", "body"));
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session/markFileViewed",
				worktreeId: "wt1",
				filePath: "a.ts",
				contentHash: hashContent("body"),
			}),
		);
		// simulate the mark now existing with that hash → toggle should unmark
		rerender({ marks: [{ filePath: "a.ts", contentHash: hashContent("body") }] });
		act(() => result.current.toggleViewed("a.ts", "body"));
		expect(dispatch).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "session/unmarkFileViewed",
				worktreeId: "wt1",
				filePath: "a.ts",
			}),
		);
	});
});
