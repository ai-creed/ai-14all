import { describe, expect, it } from "vitest";
import {
	listDmgs,
	parseIdentities,
	findDeveloperIdApplication,
	buildCodesignArgs,
	buildNotarizeArgs,
	buildStapleArgs,
} from "../../../scripts/sign-notarize-dmg.mjs";

describe("listDmgs", () => {
	it("returns every .dmg path, ignoring blockmaps and zips", () => {
		// The universal+arm64 build produces TWO dmgs; both must be signed,
		// notarized, and stapled — selecting only one would ship one unsigned.
		const entries = [
			"ai-14all-0.11.1-arm64.dmg",
			"ai-14all-0.11.1-arm64.dmg.blockmap",
			"ai-14all-0.11.1-arm64-mac.zip",
			"ai-14all-0.11.1-universal.dmg",
			"ai-14all-0.11.1-universal.dmg.blockmap",
			"ai-14all-0.11.1-universal-mac.zip",
			"latest-mac.yml",
		];
		expect(listDmgs(entries, "release")).toEqual([
			"release/ai-14all-0.11.1-arm64.dmg",
			"release/ai-14all-0.11.1-universal.dmg",
		]);
	});

	it("returns the single .dmg when only one is present (back-compat)", () => {
		const entries = [
			"ai-14all-0.7.1-arm64.dmg",
			"ai-14all-0.7.1-arm64.dmg.blockmap",
			"ai-14all-0.7.1-arm64-mac.zip",
			"latest-mac.yml",
		];
		expect(listDmgs(entries, "release")).toEqual([
			"release/ai-14all-0.7.1-arm64.dmg",
		]);
	});

	it("throws when no .dmg is present", () => {
		expect(() => listDmgs(["a.zip", "b.dmg.blockmap"], "release")).toThrow(
			/no \.dmg/i,
		);
	});
});

const FIND_IDENTITY_OUTPUT = `  1) A00B5311AF8770F6F11A75FDC99EE9A9B81143F0 "Developer ID Application: Vu Phan (4P99MVFD64)"
  2) 1111111111111111111111111111111111111111 "Apple Development: someone@example.com (ABCDE12345)"
     2 valid identities found`;

describe("parseIdentities", () => {
	it("parses hash + name pairs from security output", () => {
		const ids = parseIdentities(FIND_IDENTITY_OUTPUT);
		expect(ids).toEqual([
			{
				hash: "A00B5311AF8770F6F11A75FDC99EE9A9B81143F0",
				name: "Developer ID Application: Vu Phan (4P99MVFD64)",
			},
			{
				hash: "1111111111111111111111111111111111111111",
				name: "Apple Development: someone@example.com (ABCDE12345)",
			},
		]);
	});

	it("returns an empty array when there are no identities", () => {
		expect(parseIdentities("     0 valid identities found")).toEqual([]);
	});
});

describe("findDeveloperIdApplication", () => {
	it("finds the Developer ID Application identity for the team", () => {
		const ids = parseIdentities(FIND_IDENTITY_OUTPUT);
		expect(findDeveloperIdApplication(ids, "4P99MVFD64")).toEqual({
			hash: "A00B5311AF8770F6F11A75FDC99EE9A9B81143F0",
			name: "Developer ID Application: Vu Phan (4P99MVFD64)",
		});
	});

	it("does not match a non-Developer-ID identity even with the team id", () => {
		const ids = [{ hash: "x", name: "Apple Development: dev (4P99MVFD64)" }];
		expect(findDeveloperIdApplication(ids, "4P99MVFD64")).toBeNull();
	});

	it("returns null when the team id is absent", () => {
		const ids = parseIdentities(FIND_IDENTITY_OUTPUT);
		expect(findDeveloperIdApplication(ids, "ZZZZZZZZZZ")).toBeNull();
	});
});

describe("buildCodesignArgs", () => {
	it("force-signs the dmg with identity + timestamp", () => {
		expect(
			buildCodesignArgs({
				dmg: "release/app.dmg",
				identity: "Developer ID Application: Vu Phan (4P99MVFD64)",
			}),
		).toEqual([
			"--force",
			"--timestamp",
			"--sign",
			"Developer ID Application: Vu Phan (4P99MVFD64)",
			"release/app.dmg",
		]);
	});

	it("includes --keychain when one is provided", () => {
		expect(
			buildCodesignArgs({
				dmg: "release/app.dmg",
				identity: "ID",
				keychain: "/tmp/x.keychain-db",
			}),
		).toEqual([
			"--force",
			"--timestamp",
			"--sign",
			"ID",
			"--keychain",
			"/tmp/x.keychain-db",
			"release/app.dmg",
		]);
	});
});

describe("buildNotarizeArgs", () => {
	it("builds a notarytool submit --wait invocation", () => {
		expect(
			buildNotarizeArgs({
				dmg: "release/app.dmg",
				keyPath: "/keys/AuthKey.p8",
				keyId: "ZM5H58Y787",
				issuer: "issuer-uuid",
			}),
		).toEqual([
			"submit",
			"release/app.dmg",
			"--key",
			"/keys/AuthKey.p8",
			"--key-id",
			"ZM5H58Y787",
			"--issuer",
			"issuer-uuid",
			"--wait",
		]);
	});
});

describe("buildStapleArgs", () => {
	it("builds a stapler staple invocation", () => {
		expect(buildStapleArgs("release/app.dmg")).toEqual([
			"staple",
			"release/app.dmg",
		]);
	});
});
