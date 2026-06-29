import { describe, expect, it } from "vitest";
import { rewriteManifest } from "../../../shared/update/rewrite-manifest.js";

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

const EMITTED_TWO_DMG = `version: 0.1.0
releaseDate: '2026-04-24T10:00:00.000Z'
path: ai-14all-0.1.0-arm64-mac.zip
sha512: emlwLXNoYQ==
files:
  - url: ai-14all-0.1.0-arm64-mac.zip
    sha512: emlwLXNoYQ==
    size: 128000000
  - url: ai-14all-0.1.0-arm64.dmg
    sha512: YXJtNjQtZG1n
    size: 133000000
  - url: ai-14all-0.1.0-universal-mac.zip
    sha512: dW5pdi16aXA==
    size: 245000000
  - url: ai-14all-0.1.0-universal.dmg
    sha512: dW5pdi1kbWc=
    size: 250000000
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

	it("prefers the universal dmg for the top-level pointer and preserves all files[]", () => {
		const rewritten = rewriteManifest(EMITTED_TWO_DMG, "0.1.0");
		const base = "https://github.com/ai-creed/ai-14all/releases/download/v0.1.0";

		// Top-level legacy pointer is the UNIVERSAL dmg (deterministic), not the arm64 one.
		expect(rewritten).toContain(`path: ${base}/ai-14all-0.1.0-universal.dmg`);
		// Top-level sha512 is the universal dmg's sha512, not the arm64 dmg's.
		expect(rewritten).toContain("sha512: dW5pdi1kbWc=");
		expect(rewritten).not.toMatch(/^sha512: YXJtNjQtZG1n/m);

		// All four files[] entries survive the rewrite, each prefixed with the base.
		for (const name of [
			"ai-14all-0.1.0-arm64-mac.zip",
			"ai-14all-0.1.0-arm64.dmg",
			"ai-14all-0.1.0-universal-mac.zip",
			"ai-14all-0.1.0-universal.dmg",
		]) {
			expect(rewritten).toContain(`url: ${base}/${name}`);
		}
	});
});
