import { describe, expect, it } from "vitest";
import { isAgentProcess } from "../../../src/features/terminals/logic/agent-attention";

describe("isAgentProcess", () => {
	const positives: Array<[string, string | null]> = [
		["claude", "claude"],
		["codex", "codex"],
		["claude-code", "claude-code"],
		["claude --print", "claude --print"],
		["codex chat", "codex chat"],
		["/usr/local/bin/claude --print", "/usr/local/bin/claude --print"],
		["claude-1.2.3", "claude-1.2.3"],
		["npx codex", "npx codex"],
		["npx claude --help", "npx claude --help"],
		["codex", null],
		["claude", null],
		["claude-code", null],
	];
	const negatives: Array<[string, string | null]> = [
		["echo claude", "echo claude"],
		["npm run codex-test", "npm run codex-test"],
		["claude-stub", "claude-stub"],
		["claude-fake --x", "claude-fake --x"],
		["", ""],
		["shell 1", null],
		["working on codex", null],
		["start claude", null],
		["label only — codex", null],
		["label only — claude-code", null],
		["", null],
	];

	for (const [label, command] of positives) {
		it(`matches: label=${JSON.stringify(label)} command=${JSON.stringify(command)}`, () => {
			expect(isAgentProcess(label, command)).toBe(true);
		});
	}
	for (const [label, command] of negatives) {
		it(`rejects: label=${JSON.stringify(label)} command=${JSON.stringify(command)}`, () => {
			expect(isAgentProcess(label, command)).toBe(false);
		});
	}
});
