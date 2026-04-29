import { describe, it, expect } from "vitest";
import { countOpenCommentsInFiles } from "../../../src/features/git/logic/commit-list-badge";

describe("countOpenCommentsInFiles", () => {
	it("sums open counts for the given file paths", () => {
		expect(
			countOpenCommentsInFiles(["src/foo.ts", "src/bar.ts"], {
				"src/foo.ts": 2,
				"src/baz.ts": 5,
			}),
		).toBe(2);
	});

	it("returns 0 when no overlap", () => {
		expect(countOpenCommentsInFiles(["src/a.ts"], {})).toBe(0);
	});
});
