import { describe, expect, it } from "vitest";
import {
	compareStableVersions,
	isStableVersion,
} from "../../../shared/update/semver.js";

describe("isStableVersion", () => {
	it("accepts strict three-segment semver", () => {
		expect(isStableVersion("0.1.0")).toBe(true);
		expect(isStableVersion("10.20.30")).toBe(true);
	});

	it("rejects prerelease, build metadata, or malformed input", () => {
		expect(isStableVersion("0.1.0-beta.1")).toBe(false);
		expect(isStableVersion("0.1.0+build")).toBe(false);
		expect(isStableVersion("v0.1.0")).toBe(false);
		expect(isStableVersion("0.1")).toBe(false);
		expect(isStableVersion("0.0.1-smoke")).toBe(false);
		expect(isStableVersion("")).toBe(false);
	});
});

describe("compareStableVersions", () => {
	it("returns positive when left is newer", () => {
		expect(compareStableVersions("0.1.1", "0.1.0")).toBeGreaterThan(0);
		expect(compareStableVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
	});

	it("returns negative when left is older", () => {
		expect(compareStableVersions("0.1.0", "0.1.1")).toBeLessThan(0);
	});

	it("returns zero for equal versions", () => {
		expect(compareStableVersions("0.1.0", "0.1.0")).toBe(0);
	});

	it("throws on non-stable input", () => {
		expect(() => compareStableVersions("0.1.0-beta.1", "0.1.0")).toThrow();
		expect(() => compareStableVersions("0.1.0", "v0.1.0")).toThrow();
	});
});
