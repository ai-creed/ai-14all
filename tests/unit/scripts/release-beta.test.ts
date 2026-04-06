import { describe, expect, it } from "vitest";
import {
	computeNextBetaVersion,
	findHeadBetaTag,
	parseBetaTag,
} from "../../../scripts/release-beta.mjs";

describe("release-beta", () => {
	it("parses matching beta tags", () => {
		expect(parseBetaTag("v0.1.0-beta.4")).toEqual({
			tag: "v0.1.0-beta.4",
			version: "0.1.0-beta.4",
			sequence: 4,
		});
	});

	it("ignores non-matching tags", () => {
		expect(parseBetaTag("v0.2.0")).toBeNull();
		expect(parseBetaTag("beta-4")).toBeNull();
	});

	it("computes beta.1 when there are no prior beta tags", () => {
		expect(computeNextBetaVersion([])).toBe("0.1.0-beta.1");
	});

	it("computes the next beta suffix from prior tags", () => {
		expect(
			computeNextBetaVersion([
				"v0.1.0-beta.1",
				"v0.1.0-beta.3",
				"v0.1.0-beta.2",
			]),
		).toBe("0.1.0-beta.4");
	});

	it("detects the matching beta tag already pointing at HEAD", () => {
		expect(
			findHeadBetaTag(["v0.1.0-beta.4", "v0.2.0-beta.1"]),
		).toBe("v0.1.0-beta.4");
	});

	it("returns null when no tags match the beta pattern", () => {
		expect(findHeadBetaTag(["v0.2.0-beta.1", "v1.0.0"])).toBeNull();
		expect(findHeadBetaTag([])).toBeNull();
	});
});
