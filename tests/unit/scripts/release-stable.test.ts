import { describe, expect, it } from "vitest";
import {
	computeTargetVersion,
	isStableSemver,
	parseCli,
	rewriteVersionInPackageJson,
} from "../../../scripts/release-stable.mjs";

describe("parseCli", () => {
	it("parses patch / minor / major", () => {
		expect(parseCli(["patch"])).toEqual({ mode: "bump", bump: "patch" });
		expect(parseCli(["minor"])).toEqual({ mode: "bump", bump: "minor" });
		expect(parseCli(["major"])).toEqual({ mode: "bump", bump: "major" });
	});
	it("parses explicit version", () => {
		expect(parseCli(["--version", "0.1.0"])).toEqual({
			mode: "explicit",
			version: "0.1.0",
		});
	});
	it("rejects unknown input", () => {
		expect(() => parseCli([])).toThrow();
		expect(() => parseCli(["foo"])).toThrow();
	});
});

describe("computeTargetVersion", () => {
	it("bumps patch on an already-stable version", () => {
		expect(
			computeTargetVersion({
				current: "0.1.0",
				cli: { mode: "bump", bump: "patch" },
			}),
		).toBe("0.1.1");
	});
	it("bumps minor and resets patch", () => {
		expect(
			computeTargetVersion({
				current: "0.1.4",
				cli: { mode: "bump", bump: "minor" },
			}),
		).toBe("0.2.0");
	});
	it("bumps major and resets minor and patch", () => {
		expect(
			computeTargetVersion({
				current: "0.3.2",
				cli: { mode: "bump", bump: "major" },
			}),
		).toBe("1.0.0");
	});
	it("accepts explicit version from any current version", () => {
		expect(
			computeTargetVersion({
				current: "0.1.0-beta.14",
				cli: { mode: "explicit", version: "0.1.0" },
			}),
		).toBe("0.1.0");
	});
	it("rejects bump mode when current is non-stable", () => {
		expect(() =>
			computeTargetVersion({
				current: "0.1.0-beta.14",
				cli: { mode: "bump", bump: "patch" },
			}),
		).toThrow(/explicit/);
	});
	it("rejects explicit version that is not stable semver", () => {
		expect(() =>
			computeTargetVersion({
				current: "0.1.0",
				cli: { mode: "explicit", version: "0.1.0-beta.1" },
			}),
		).toThrow();
	});
});

describe("isStableSemver", () => {
	it("matches strict three-segment semver only", () => {
		expect(isStableSemver("0.1.0")).toBe(true);
		expect(isStableSemver("0.1.0-beta.1")).toBe(false);
	});
});

describe("rewriteVersionInPackageJson", () => {
	it("updates the version field and preserves trailing newline", () => {
		const input = '{\n\t"name": "x",\n\t"version": "0.1.0-beta.14"\n}\n';
		expect(rewriteVersionInPackageJson(input, "0.1.0")).toBe(
			'{\n\t"name": "x",\n\t"version": "0.1.0"\n}\n',
		);
	});
});
