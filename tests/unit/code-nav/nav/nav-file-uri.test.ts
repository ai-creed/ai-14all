import { describe, expect, it } from "vitest";
import {
	fromFileUri,
	toFileUri,
} from "../../../../src/features/code-nav/nav/nav-file-uri.js";

describe("nav-file-uri", () => {
	it("toFileUri builds a file:// URI from worktree root + relative file", () => {
		expect(toFileUri("/wt", "src/a.ts")).toBe("file:///wt/src/a.ts");
		expect(toFileUri("/wt/", "/src/a.ts")).toBe("file:///wt/src/a.ts");
	});

	it("round-trips toFileUri → fromFileUri", () => {
		const uri = toFileUri("/Users/me/wt", "src/components/X.tsx");
		expect(fromFileUri("/Users/me/wt", uri)).toBe("src/components/X.tsx");
	});

	it("fromFileUri decodes percent-encoded segments", () => {
		expect(fromFileUri("/wt", "file:///wt/src/my%20file.ts")).toBe(
			"src/my file.ts",
		);
	});

	it("fromFileUri returns null for a path outside the worktree", () => {
		expect(fromFileUri("/wt", "file:///other/x.ts")).toBeNull();
		// prefix-but-not-a-child guard: /wt-sibling must not match /wt
		expect(fromFileUri("/wt", "file:///wt-sibling/x.ts")).toBeNull();
	});

	it("fromFileUri returns null for non-file schemes", () => {
		expect(fromFileUri("/wt", "cortex://nav/abc")).toBeNull();
		expect(fromFileUri("/wt", "inmemory://model/1")).toBeNull();
	});
});
