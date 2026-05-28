import { describe, expect, it } from "vitest";
import {
	IGNORED_DENYLIST,
	isUnderDenylistedDir,
} from "../../../shared/files/ignored-denylist";

describe("ignored-denylist", () => {
	it("includes the expected dependency / build / IDE directory names", () => {
		expect(IGNORED_DENYLIST).toEqual(
			expect.arrayContaining([
				"node_modules",
				".git",
				"dist",
				"build",
				".next",
				".cache",
				".turbo",
				"target",
				".venv",
				"venv",
				"__pycache__",
				".gradle",
				".idea",
				"vendor",
			]),
		);
	});

	it("matches files inside a denylisted directory (any depth)", () => {
		expect(isUnderDenylistedDir("node_modules/foo")).toBe(true);
		expect(isUnderDenylistedDir(".git/HEAD")).toBe(true);
		expect(isUnderDenylistedDir("dist/bundle.js")).toBe(true);
	});

	it("matches when the denylisted segment appears nested in the path", () => {
		expect(isUnderDenylistedDir("packages/x/node_modules/y/z.js")).toBe(true);
		expect(isUnderDenylistedDir("apps/web/.next/cache/foo")).toBe(true);
	});

	it("does NOT match by prefix — segment equality only", () => {
		expect(isUnderDenylistedDir("node_modules_legit/foo")).toBe(false);
		expect(isUnderDenylistedDir("distance/foo")).toBe(false);
		expect(isUnderDenylistedDir("my-vendor/foo")).toBe(false);
	});

	it("matches a bare denylisted segment (no descendant component)", () => {
		expect(isUnderDenylistedDir("node_modules")).toBe(true);
	});

	it("is case-sensitive", () => {
		expect(isUnderDenylistedDir("Node_Modules/foo")).toBe(false);
		expect(isUnderDenylistedDir("NODE_MODULES/foo")).toBe(false);
	});

	it("treats leading slashes and empty segments safely", () => {
		expect(isUnderDenylistedDir("/node_modules/foo")).toBe(true);
		expect(isUnderDenylistedDir("")).toBe(false);
	});
});
