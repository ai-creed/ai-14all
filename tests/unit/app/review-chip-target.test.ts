import { describe, it, expect } from "vitest";
import { firstViewableChangedFile } from "../../../src/app/logic/review-chip-target";
import type { GitChange } from "../../../shared/models/git-change";

function change(path: string, status: GitChange["status"]): GitChange {
	return { path, status };
}

describe("firstViewableChangedFile", () => {
	it("returns the first non-deleted change", () => {
		const changes = [change("a.ts", "M"), change("b.ts", "A")];
		expect(firstViewableChangedFile(changes)).toEqual(change("a.ts", "M"));
	});

	it("skips a leading deleted file and returns the first viewable one", () => {
		const changes = [change("gone.ts", "D"), change("kept.ts", "M")];
		expect(firstViewableChangedFile(changes)).toEqual(change("kept.ts", "M"));
	});

	it("returns null when every change is a deletion", () => {
		const changes = [change("x.ts", "D"), change("y.ts", "D")];
		expect(firstViewableChangedFile(changes)).toBeNull();
	});

	it("returns null for an empty list", () => {
		expect(firstViewableChangedFile([])).toBeNull();
	});
});
