import { describe, expect, it } from "vitest";
import {
	parseManifest,
	type UpdateManifest,
} from "../../../shared/update/manifest.js";

const VALID = `version: 0.1.1
releaseDate: '2026-05-01T12:00:00.000Z'
path: https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64.dmg
sha512: ZHVtbXktZG1nLXNoYQ==
files:
  - url: https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64.dmg
    sha512: ZHVtbXktZG1nLXNoYQ==
    size: 1000
  - url: https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64-mac.zip
    sha512: ZHVtbXktemlwLXNoYQ==
    size: 2000
`;

describe("parseManifest", () => {
	it("parses a valid manifest into typed shape", () => {
		const result = parseManifest(VALID);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const m: UpdateManifest = result.value;
		expect(m.version).toBe("0.1.1");
		expect(m.path).toBe(
			"https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64.dmg",
		);
		expect(m.files.length).toBe(2);
	});

	it("rejects prerelease version", () => {
		const bad = VALID.replace("version: 0.1.1", "version: 0.1.1-beta.1");
		const result = parseManifest(bad);
		expect(result.ok).toBe(false);
	});

	it("rejects path on wrong host", () => {
		const bad = VALID.replace(
			"https://github.com/ai-creed/ai-14all/releases/download/",
			"https://evil.example.com/",
		);
		const result = parseManifest(bad);
		expect(result.ok).toBe(false);
	});

	it("rejects missing fields", () => {
		const bad = VALID.replace(/^releaseDate:.*\n/m, "");
		const result = parseManifest(bad);
		expect(result.ok).toBe(false);
	});

	it("rejects malformed yaml", () => {
		const result = parseManifest("not: [yaml");
		expect(result.ok).toBe(false);
	});
});
