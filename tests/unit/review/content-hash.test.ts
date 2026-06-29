// tests/unit/review/content-hash.test.ts
import { describe, expect, it } from "vitest";
import { hashContent } from "../../../src/features/review/logic/content-hash";

describe("hashContent", () => {
	it("is deterministic for identical input", () => {
		expect(hashContent("hello world")).toBe(hashContent("hello world"));
	});

	it("differs when content changes", () => {
		expect(hashContent("a")).not.toBe(hashContent("b"));
	});

	it("returns an 8-char hex string", () => {
		expect(hashContent("anything")).toMatch(/^[0-9a-f]{8}$/);
	});

	it("handles empty input without throwing", () => {
		expect(hashContent("")).toMatch(/^[0-9a-f]{8}$/);
	});
});
