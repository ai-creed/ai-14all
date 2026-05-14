import { describe, expect, it } from "vitest";
import { ReviewCommentChangedEventSchema } from "../../../shared/contracts/review-comments";

describe("ReviewCommentChangedEventSchema", () => {
	it("accepts the 'updated' kind", () => {
		const parsed = ReviewCommentChangedEventSchema.parse({ kind: "updated" });
		expect(parsed.kind).toBe("updated");
	});

	it("still accepts the original kinds", () => {
		for (const kind of ["created", "addressed", "reopened", "deleted", "rebased"] as const) {
			expect(ReviewCommentChangedEventSchema.parse({ kind }).kind).toBe(kind);
		}
	});
});
