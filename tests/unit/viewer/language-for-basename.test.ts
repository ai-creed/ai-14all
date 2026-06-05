import { describe, expect, it } from "vitest";
import { languageForBasename } from "../../../src/features/viewer/logic/language-for-basename.js";

describe("languageForBasename", () => {
	it("maps known extensions", () => {
		expect(languageForBasename("a.ts")).toBe("typescript");
		expect(languageForBasename("a.tsx")).toBe("typescript");
		expect(languageForBasename("a.js")).toBe("javascript");
		expect(languageForBasename("a.py")).toBe("python");
		expect(languageForBasename("a.json")).toBe("json");
		expect(languageForBasename("a.md")).toBe("markdown");
	});

	it("falls back to plaintext for unknown extensions", () => {
		expect(languageForBasename("a.unknownext")).toBe("plaintext");
		expect(languageForBasename("Makefile")).toBe("plaintext");
	});
});
