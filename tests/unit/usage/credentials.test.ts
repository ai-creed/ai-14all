import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readClaudeTier } from "../../../services/usage/credentials.js";

describe("readClaudeTier", () => {
	it("reads rateLimitTier from a credentials file", () => {
		const dir = mkdtempSync(join(tmpdir(), "cred-"));
		const file = join(dir, ".credentials.json");
		writeFileSync(
			file,
			JSON.stringify({
				claudeAiOauth: { rateLimitTier: "default_claude_max_5x" },
			}),
		);
		expect(readClaudeTier(file)).toBe("default_claude_max_5x");
	});
	it("returns empty string when missing/malformed", () => {
		expect(readClaudeTier("/no/such/file.json")).toBe("");
	});
});
