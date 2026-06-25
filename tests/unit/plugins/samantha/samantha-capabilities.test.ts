// tests/unit/plugins/samantha/samantha-capabilities.test.ts
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "../../../../services/plugins/samantha/samantha-driver";

describe("CAPABILITIES metadata", () => {
	it("focus-worktree carries LLM-facing description and worktree-key inputSchema", () => {
		const focus = CAPABILITIES.find((c) => c.id === "focus-worktree");
		expect(focus?.description).toMatch(/worktree/i);
		expect(focus?.inputSchema).toEqual({
			type: "object",
			properties: {
				worktree: {
					type: "string",
					description:
						"A '<repo>/<branch>' key exactly as shown in the latest ai-14all snapshot.",
				},
			},
			required: ["worktree"],
		});
	});

	it("session-report carries LLM-facing description and argless inputSchema", () => {
		const report = CAPABILITIES.find((c) => c.id === "session-report");
		expect(report?.description).toMatch(/status/i);
		expect(report?.inputSchema).toEqual({ type: "object", properties: {} });
	});
});

describe("CAPABILITIES instruct-session", () => {
	it("advertises instruct-session with confirmation + risk + input schema", () => {
		const cap = CAPABILITIES.find((c) => c.id === "instruct-session");
		expect(cap).toBeDefined();
		expect(cap).toMatchObject({
			id: "instruct-session",
			requiresConfirmation: true,
			risk: "drives-agent",
		});
		const schema = (
			cap as {
				inputSchema: {
					properties: Record<string, unknown>;
					required: string[];
				};
			}
		).inputSchema;
		expect(schema.properties).toHaveProperty("worktree");
		expect(schema.properties).toHaveProperty("instruction");
		expect(schema.required).toEqual(
			expect.arrayContaining(["worktree", "instruction"]),
		);
	});
});
