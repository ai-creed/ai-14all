import { describe, expect, it } from "vitest";
import {
	AGENT_PROVIDERS,
	AGENT_PROVIDER_IDS,
	PROVIDER_LABEL,
	providerDef,
} from "../../../shared/models/agent-provider";

describe("agent-provider registry", () => {
	it("lists all five agents in stable order", () => {
		expect(AGENT_PROVIDER_IDS).toEqual([
			"claude",
			"codex",
			"ezio",
			"cursor",
			"antigravity",
		]);
	});

	it("derives labels from the registry", () => {
		expect(PROVIDER_LABEL).toEqual({
			claude: "Claude",
			codex: "Codex",
			ezio: "Ezio",
			cursor: "Cursor",
			antigravity: "Antigravity",
		});
	});

	it("exposes binary, whisperCapable, and brand per provider", () => {
		expect(providerDef("claude")).toMatchObject({
			binary: "claude",
			whisperCapable: true,
			brand: "var(--provider-claude)",
		});
	});

	it("derives a brand token for every provider", () => {
		for (const def of AGENT_PROVIDERS) {
			expect(def.brand).toBe(`var(--provider-${def.id})`);
		}
	});

	it("throws on an unknown id", () => {
		// @ts-expect-error — exercising the runtime guard
		expect(() => providerDef("nope")).toThrow();
	});
});
