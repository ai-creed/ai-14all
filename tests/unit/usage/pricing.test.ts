import { describe, expect, it } from "vitest";
import { rateFor } from "../../../services/usage/cost/pricing.js";

describe("rateFor (blended per-provider)", () => {
	it("prices every known provider with its median rate, ignoring model", () => {
		const claude = rateFor("claude");
		expect(claude).toEqual({
			inputPerM: 3,
			outputPerM: 15,
			cacheReadPerM: 0.3,
		});
		const codex = rateFor("codex");
		expect(codex).toEqual({
			inputPerM: 1.25,
			outputPerM: 10,
			cacheReadPerM: 0.125,
		});
		expect(rateFor("ezio")).toEqual(codex); // ezio runs on the codex/OpenAI provider
	});

	it("falls back to GLOBAL_AVG for an unknown provider (never null)", () => {
		// cursor/antigravity are inert today but must still price, never $0/unpriced.
		expect(rateFor("cursor")).toEqual({
			inputPerM: 2,
			outputPerM: 12,
			cacheReadPerM: 0.2,
		});
		expect(rateFor("antigravity")).toEqual({
			inputPerM: 2,
			outputPerM: 12,
			cacheReadPerM: 0.2,
		});
	});
});
