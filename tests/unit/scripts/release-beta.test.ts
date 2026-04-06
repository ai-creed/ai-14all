import { describe, expect, it } from "vitest";
import {
	computeNextBetaVersion,
	createReleasePlan,
	findHeadBetaTag,
	isWorkingTreeClean,
	parseBetaTag,
	updatePackageJsonVersion,
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

	it("returns the highest-sequence beta tag when multiple tags point at HEAD", () => {
		expect(findHeadBetaTag(["v0.1.0-beta.2", "v0.1.0-beta.10"])).toBe("v0.1.0-beta.10");
	});
});

describe("release-beta plan", () => {
	it("chooses rebuild mode when HEAD already has a beta tag", () => {
		expect(
			createReleasePlan({
				headTags: ["v0.1.0-beta.3"],
				allTags: ["v0.1.0-beta.1", "v0.1.0-beta.2", "v0.1.0-beta.3"],
			}),
		).toEqual({
			mode: "rebuild",
			version: "0.1.0-beta.3",
			tag: "v0.1.0-beta.3",
		});
	});

	it("chooses new-release mode and increments the beta suffix", () => {
		expect(
			createReleasePlan({
				headTags: [],
				allTags: ["v0.1.0-beta.1", "v0.1.0-beta.2"],
			}),
		).toEqual({
			mode: "new-release",
			version: "0.1.0-beta.3",
			tag: "v0.1.0-beta.3",
		});
	});

	it("updates the package version and preserves trailing newline", () => {
		expect(
			updatePackageJsonVersion(
				'{\n\t"name": "ai-14all",\n\t"version": "0.1.0-dev"\n}\n',
				"0.1.0-beta.3",
			),
		).toBe('{\n\t"name": "ai-14all",\n\t"version": "0.1.0-beta.3"\n}\n');
	});

	it("updates the package version without adding a trailing newline when one was not present", () => {
		expect(
			updatePackageJsonVersion(
				'{\n\t"name": "ai-14all",\n\t"version": "0.1.0-dev"\n}',
				"0.1.0-beta.3",
			),
		).toBe('{\n\t"name": "ai-14all",\n\t"version": "0.1.0-beta.3"\n}');
	});

	it("detects a clean working tree", () => {
		expect(isWorkingTreeClean("")).toBe(true);
		expect(isWorkingTreeClean("\n")).toBe(true);
	});

	it("detects a dirty working tree", () => {
		expect(isWorkingTreeClean(" M scripts/release-beta.mjs\n")).toBe(false);
	});

	it("keeps rebuild mode when HEAD is already tagged", () => {
		expect(
			createReleasePlan({
				headTags: ["v0.1.0-beta.4"],
				allTags: ["v0.1.0-beta.1", "v0.1.0-beta.4"],
			}),
		).toEqual({
			mode: "rebuild",
			version: "0.1.0-beta.4",
			tag: "v0.1.0-beta.4",
		});
	});
});
