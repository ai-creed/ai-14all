import { describe, expect, it } from "vitest";
import { unavailableMessage } from "../../../src/features/code-nav/palette/unavailable-message.js";

describe("unavailableMessage", () => {
	it("prompts to update for an unsupported schema", () => {
		expect(unavailableMessage("unsupported-schema")).toMatch(
			/update ai-cortex/i,
		);
	});
	it("prompts to install for no-cortex and not-indexed", () => {
		expect(unavailableMessage("no-cortex")).toMatch(/install ai-cortex/i);
		expect(unavailableMessage("not-indexed")).toMatch(/install ai-cortex/i);
	});
	it("returns null when reason is null (available)", () => {
		expect(unavailableMessage(null)).toBeNull();
	});
});
