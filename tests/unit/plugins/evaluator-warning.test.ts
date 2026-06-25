import { describe, expect, it } from "vitest";
import { evaluatorWarning } from "../../../src/features/plugins/components/PluginsPanelDialog";

describe("evaluatorWarning", () => {
	it("explains a missing Anthropic key, points at auth.json, and hedges on the shell-exported env case", () => {
		const msg = evaluatorWarning("missing_anthropic_key");
		expect(msg).toMatch(/evaluator/i);
		expect(msg).toMatch(/auth\.json/);
		// GUI-launched 14all can't see a shell-exported key, so the warning must say
		// so rather than crying wolf.
		expect(msg).toMatch(/ANTHROPIC_API_KEY/);
	});

	it("flags an invalid evaluator config", () => {
		expect(evaluatorWarning("invalid_config")).toMatch(/invalid/i);
	});

	it("falls back to a generic not-ready message for any other status", () => {
		expect(evaluatorWarning("some_future_status")).toMatch(/evaluator/i);
	});
});
