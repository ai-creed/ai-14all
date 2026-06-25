import { describe, expect, it } from "vitest";
import { ProviderIdSchema } from "../../../shared/contracts/agent-install.js";

describe("ProviderIdSchema", () => {
	it("accepts the three supported agent providers", () => {
		expect(ProviderIdSchema.parse("claude-code")).toBe("claude-code");
		expect(ProviderIdSchema.parse("codex")).toBe("codex");
		expect(ProviderIdSchema.parse("ezio")).toBe("ezio");
	});

	it("rejects an unknown provider id", () => {
		expect(() => ProviderIdSchema.parse("gemini")).toThrow();
	});
});
