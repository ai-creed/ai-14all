import { describe, expect, it } from "vitest";
import { deriveAttentionState } from "../../../src/features/terminals/logic/process-attention";

describe("deriveAttentionState", () => {
	it("returns actionRequired for confirmation prompts", () => {
		expect(deriveAttentionState("Continue? [y/N]")).toBe("actionRequired");
	});

	it("returns actionRequired for obvious failures", () => {
		expect(deriveAttentionState("ERROR: build failed")).toBe("actionRequired");
	});

	it("returns activity for normal output", () => {
		expect(deriveAttentionState("compiled in 120ms")).toBe("activity");
	});

	it("returns idle for empty output", () => {
		expect(deriveAttentionState("")).toBe("idle");
	});
});
