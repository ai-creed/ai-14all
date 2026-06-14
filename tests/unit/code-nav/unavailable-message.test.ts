import { describe, expect, it } from "vitest";
import { unavailableMessage } from "../../../src/features/code-nav/palette/unavailable-message";

describe("unavailableMessage", () => {
	it("maps cortex-disabled to an enable hint", () => {
		expect(unavailableMessage("cortex-disabled")).toBe(
			"Enable ai-cortex to use code navigation.",
		);
	});

	it("still maps not-indexed to the install hint", () => {
		expect(unavailableMessage("not-indexed")).toBe(
			"Install ai-cortex ≥ 0.13 to enable code navigation.",
		);
	});

	it("returns null when available (reason null)", () => {
		expect(unavailableMessage(null)).toBeNull();
	});
});
