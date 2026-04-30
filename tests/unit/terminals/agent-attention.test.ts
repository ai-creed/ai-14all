import { describe, expect, it } from "vitest";
import { isAgentProcess, classifyOutput } from "../../../src/features/terminals/logic/agent-attention";

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

describe("classifyOutput", () => {
	it("returns waiting for y/n prompt", () => {
		expect(classifyOutput("Continue? [y/N]")).toBe("waiting");
	});
	it("returns waiting for permission prompt", () => {
		expect(classifyOutput("Allow this command? (yes/no)")).toBe("waiting");
	});
	it("returns waiting for direct question", () => {
		expect(classifyOutput("What should I do next?")).toBe("waiting");
	});
	it("returns failed for error", () => {
		expect(classifyOutput("Error: build failed")).toBe("failed");
	});
	it("returns failed for exception", () => {
		expect(classifyOutput("uncaught exception in worker")).toBe("failed");
	});
	it("returns ready for completion", () => {
		expect(classifyOutput("implementation complete")).toBe("ready");
	});
	it("returns ready for tests pass", () => {
		expect(classifyOutput("All checks passed")).toBe("ready");
	});
	it("returns active for non-empty neutral output", () => {
		expect(classifyOutput("compiling module foo")).toBe("active");
	});
	it("returns null for empty chunk", () => {
		expect(classifyOutput("   ")).toBeNull();
	});
	it("prefers waiting over ready in mixed chunks", () => {
		expect(classifyOutput("done. Continue? [y/N]")).toBe("waiting");
	});
	it("prefers failed over ready in mixed chunks", () => {
		expect(classifyOutput("tests pass\nerror: post-step crashed")).toBe("failed");
	});
});
