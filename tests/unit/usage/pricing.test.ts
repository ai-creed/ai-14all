import { describe, expect, it } from "vitest";
import { rateFor } from "../../../services/usage/cost/pricing.js";

describe("rateFor", () => {
	it("matches only an exact (provider, model)", () => {
		expect(rateFor("claude", "claude-opus-4-6")?.outputPerM).toBe(75);
		expect(rateFor("codex", "gpt-5-codex")?.inputPerM).toBe(1.25);
	});
	it("returns null for any unrecognized model — no prefix or default guessing", () => {
		// A dated variant that is NOT enumerated must NOT inherit a base rate.
		expect(rateFor("claude", "claude-opus-4-6-20260101")).toBeNull();
		// A new model sharing a broad prefix must NOT be silently priced.
		expect(rateFor("codex", "gpt-5-something-new")).toBeNull();
		expect(rateFor("claude", "mystery-model")).toBeNull();
		expect(rateFor("ezio", "")).toBeNull();
		expect(rateFor("cursor", "anything")).toBeNull();
	});
});
