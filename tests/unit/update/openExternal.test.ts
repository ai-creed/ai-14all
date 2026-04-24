import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "../../../electron/main/services/openExternal.js";

describe("isAllowedExternalUrl", () => {
	it("accepts URLs on the canonical download host", () => {
		expect(
			isAllowedExternalUrl(
				"https://github.com/ai-creed/ai-14all/releases/download/v0.1.0/foo.dmg",
			),
		).toBe(true);
	});

	it("rejects other hosts", () => {
		expect(isAllowedExternalUrl("https://evil.example.com/malware.dmg")).toBe(
			false,
		);
		expect(
			isAllowedExternalUrl("https://downloads.ai-creed.dev/ai-14all/foo.dmg"),
		).toBe(false);
	});

	it("rejects non-https schemes", () => {
		expect(isAllowedExternalUrl("http://downloads.ai-creed.dev/foo.dmg")).toBe(
			false,
		);
		expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
	});

	it("rejects malformed input", () => {
		expect(isAllowedExternalUrl("not a url")).toBe(false);
		expect(isAllowedExternalUrl("")).toBe(false);
	});
});
