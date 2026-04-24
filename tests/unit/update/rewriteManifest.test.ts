import { describe, expect, it } from "vitest";
import { rewriteManifest } from "../../../shared/update/rewriteManifest.js";

const EMITTED = `version: 0.1.0
releaseDate: '2026-04-24T10:00:00.000Z'
path: ai-14all-0.1.0-arm64-mac.zip
sha512: emlwLXNoYQ==
files:
  - url: ai-14all-0.1.0-arm64-mac.zip
    sha512: emlwLXNoYQ==
    size: 128000000
  - url: ai-14all-0.1.0-arm64.dmg
    sha512: ZG1nLXNoYQ==
    size: 133000000
`;

describe("rewriteManifest", () => {
	it("prefixes every file url with the canonical base and swaps path to the DMG", () => {
		const rewritten = rewriteManifest(EMITTED, "0.1.0");
		expect(rewritten).toContain(
			"path: https://github.com/ai-creed/ai-14all/releases/download/v0.1.0/ai-14all-0.1.0-arm64.dmg",
		);
		expect(rewritten).toContain(
			"url: https://github.com/ai-creed/ai-14all/releases/download/v0.1.0/ai-14all-0.1.0-arm64.dmg",
		);
		expect(rewritten).toContain(
			"url: https://github.com/ai-creed/ai-14all/releases/download/v0.1.0/ai-14all-0.1.0-arm64-mac.zip",
		);
	});

	it("copies the DMG sha512 into the top-level sha512", () => {
		const rewritten = rewriteManifest(EMITTED, "0.1.0");
		expect(rewritten).toContain("sha512: ZG1nLXNoYQ==");
		expect(rewritten).not.toMatch(/^sha512: emlwLXNoYQ==/m);
	});

	it("throws when the DMG entry is missing", () => {
		const broken = EMITTED.replace(
			/- url: ai-14all-0\.1\.0-arm64\.dmg[\s\S]*$/,
			"",
		);
		expect(() => rewriteManifest(broken, "0.1.0")).toThrow();
	});

	it("throws when emitted version disagrees with target", () => {
		expect(() => rewriteManifest(EMITTED, "0.1.1")).toThrow();
	});
});
