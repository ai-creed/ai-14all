import { describe, expect, it } from "vitest";
import {
	isAgentProcess,
	classifyOutput,
} from "../../../src/features/terminals/logic/agent-attention";

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
		// Label-as-command: agent CLIs may set OSC title with flags or argv-style values.
		// Detection must use first-token logic on the label, mirroring command-side rules.
		["claude --print", null],
		["codex chat", null],
		["claude-1.2.3", null],
		["/usr/local/bin/claude --print", null],
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

	it("detects an agent invoked via a Windows backslash path", () => {
		expect(isAgentProcess("", "C:\\tools\\bin\\claude --print")).toBe(true);
		expect(isAgentProcess("", "C:\\tools\\bin\\codex")).toBe(true);
	});
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
		expect(classifyOutput("tests pass\nerror: post-step crashed")).toBe(
			"failed",
		);
	});
});

describe("classifyOutput — Claude Code mode footer (RC1)", () => {
	it("does not classify the persistent bypass-permissions footer as waiting", () => {
		expect(
			classifyOutput("⏵⏵ bypass permissions on (shift+tab to cycle)"),
		).toBeNull();
	});
	it("does not classify the accept-edits footer as waiting", () => {
		expect(
			classifyOutput("⏵⏵ accept edits on (shift+tab to cycle)"),
		).toBeNull();
	});
	it("does not classify the plan-mode footer as waiting", () => {
		expect(classifyOutput("⏸ plan mode on (shift+tab to cycle)")).toBeNull();
	});
	it("ignores the footer but still detects a real failure in the same chunk", () => {
		expect(
			classifyOutput(
				"error: build failed\n⏵⏵ bypass permissions on (shift+tab to cycle)",
			),
		).toBe("failed");
	});
	it("ignores the footer but still detects completion in the same chunk", () => {
		expect(
			classifyOutput(
				"implementation complete\n⏵⏵ bypass permissions on (shift+tab to cycle)",
			),
		).toBe("ready");
	});
	it("strips footer but classifies remaining neutral output as active", () => {
		expect(
			classifyOutput(
				"compiling module foo\n⏵⏵ bypass permissions on (shift+tab to cycle)",
			),
		).toBe("active");
	});
	it("still classifies a genuine permission prompt (not the footer) as waiting", () => {
		expect(classifyOutput("Grant write permission to continue? (yes/no)")).toBe(
			"waiting",
		);
	});
});

describe("classifyOutput — telemetry", () => {
	it("emits a classifier event when verdict is non-active", () => {
		const emitted: unknown[] = [];
		const result = classifyOutput("Error: something exploded", {
			emit: (e) => emitted.push(e),
		});
		expect(result).toBe("failed");
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			type: "classifier",
			state: "failed",
			matchedPattern: expect.any(String),
		});
	});
	it("does not emit when verdict is neutral/active", () => {
		const emitted: unknown[] = [];
		classifyOutput("Hello there, plain output.", {
			emit: (e) => emitted.push(e),
		});
		expect(emitted).toHaveLength(0);
	});
	it("does not emit for empty chunks (null verdict)", () => {
		const emitted: unknown[] = [];
		const result = classifyOutput("   ", { emit: (e) => emitted.push(e) });
		expect(result).toBeNull();
		expect(emitted).toHaveLength(0);
	});
	it("emits the actual matched pattern source and a truncated input sample", () => {
		const emitted: Array<{
			matchedPattern: string;
			state: string;
			inputSample: string;
			inputPrev: string;
		}> = [];
		const longChunk = `Continue? [y/N] ${"x".repeat(800)}`;
		classifyOutput(longChunk, {
			emit: (e) =>
				emitted.push(
					e as {
						matchedPattern: string;
						state: string;
						inputSample: string;
						inputPrev: string;
					},
				),
		});
		expect(emitted).toHaveLength(1);
		expect(emitted[0].state).toBe("waiting");
		expect(emitted[0].matchedPattern.length).toBeGreaterThan(0);
		expect(new RegExp(emitted[0].matchedPattern, "i").test("y/n")).toBe(true);
		expect(emitted[0].inputSample.length).toBe(500);
		expect(emitted[0].inputPrev).toBe("");
	});
	it("does not throw and still classifies when no emit is supplied", () => {
		expect(classifyOutput("Error: boom")).toBe("failed");
	});
});

import {
	deriveStale,
	mapToProcessAttentionState,
	rankAgentAttention,
	shouldReplaceAgentAttentionReason,
} from "../../../src/features/terminals/logic/agent-attention";
import type {
	AgentAttentionReason,
	AgentAttentionReasonsBySource,
} from "../../../shared/models/agent-attention";
import { STALE_THRESHOLD_MS } from "../../../shared/models/agent-attention";

const reason = (
	state: AgentAttentionReason["state"],
	source: AgentAttentionReason["source"],
): AgentAttentionReason => ({
	state,
	source,
	summary: state,
	nextAction: null,
	reportedAt: 0,
});

describe("deriveStale", () => {
	it("returns false when lastActivityAt is null", () => {
		expect(deriveStale(1_000_000, null, null)).toBe(false);
	});
	it("returns false just under threshold", () => {
		expect(deriveStale(STALE_THRESHOLD_MS - 1, 0, null)).toBe(false);
	});
	it("returns true at exactly the threshold", () => {
		expect(deriveStale(STALE_THRESHOLD_MS, 0, null)).toBe(true);
	});
	it("returns true above threshold", () => {
		expect(deriveStale(STALE_THRESHOLD_MS + 1, 0, null)).toBe(true);
	});
	it("returns false when agentAttentionClearedAt >= lastActivityAt (already viewed)", () => {
		expect(deriveStale(STALE_THRESHOLD_MS + 1_000, 0, 500)).toBe(false);
	});
	it("returns true again once new activity happens after clear", () => {
		expect(deriveStale(2 * STALE_THRESHOLD_MS, STALE_THRESHOLD_MS, 500)).toBe(
			true,
		);
	});
});

describe("shouldReplaceAgentAttentionReason", () => {
	it("returns true when current is undefined", () => {
		expect(
			shouldReplaceAgentAttentionReason(
				undefined,
				reason("active", "terminal"),
			),
		).toBe(true);
	});
	it("returns true when next is equal rank to current (refresh)", () => {
		expect(
			shouldReplaceAgentAttentionReason(
				reason("waiting", "terminal"),
				reason("waiting", "terminal"),
			),
		).toBe(true);
	});
	it("returns true when next is stronger than current", () => {
		expect(
			shouldReplaceAgentAttentionReason(
				reason("active", "terminal"),
				reason("waiting", "terminal"),
			),
		).toBe(true);
	});
	it("returns false when next is weaker than current (do not downgrade)", () => {
		expect(
			shouldReplaceAgentAttentionReason(
				reason("waiting", "terminal"),
				reason("active", "terminal"),
			),
		).toBe(false);
		expect(
			shouldReplaceAgentAttentionReason(
				reason("failed", "lifecycle"),
				reason("ready", "lifecycle"),
			),
		).toBe(false);
	});
});

describe("rankAgentAttention", () => {
	it("returns idle when reasons empty and not stale", () => {
		expect(rankAgentAttention({}, false)).toBe("idle");
	});
	it("returns stale when stale and no stronger reason", () => {
		expect(rankAgentAttention({}, true)).toBe("stale");
	});
	it("stale beats active (active rank < stale rank)", () => {
		expect(
			rankAgentAttention({ terminal: reason("active", "terminal") }, true),
		).toBe("stale");
	});
	it("ready beats stale", () => {
		const reasons: AgentAttentionReasonsBySource = {
			terminal: reason("ready", "terminal"),
		};
		expect(rankAgentAttention(reasons, true)).toBe("ready");
	});
	it("failed beats ready across sources", () => {
		const reasons: AgentAttentionReasonsBySource = {
			lifecycle: reason("failed", "lifecycle"),
			terminal: reason("ready", "terminal"),
		};
		expect(rankAgentAttention(reasons, false)).toBe("failed");
	});
	it("waiting beats failed", () => {
		const reasons: AgentAttentionReasonsBySource = {
			lifecycle: reason("failed", "lifecycle"),
			mcp: reason("waiting", "mcp"),
		};
		expect(rankAgentAttention(reasons, false)).toBe("waiting");
	});
	it("MCP active does not downgrade lifecycle failed", () => {
		const reasons: AgentAttentionReasonsBySource = {
			lifecycle: reason("failed", "lifecycle"),
			mcp: reason("active", "mcp"),
		};
		expect(rankAgentAttention(reasons, false)).toBe("failed");
	});
});

describe("mapToProcessAttentionState", () => {
	it("waiting -> actionRequired", () => {
		expect(mapToProcessAttentionState("waiting")).toBe("actionRequired");
	});
	it("failed -> actionRequired", () => {
		expect(mapToProcessAttentionState("failed")).toBe("actionRequired");
	});
	it("ready -> activity", () => {
		expect(mapToProcessAttentionState("ready")).toBe("activity");
	});
	it("active -> activity", () => {
		expect(mapToProcessAttentionState("active")).toBe("activity");
	});
	it("stale -> activity", () => {
		expect(mapToProcessAttentionState("stale")).toBe("activity");
	});
	it("idle -> idle", () => {
		expect(mapToProcessAttentionState("idle")).toBe("idle");
	});
});

describe("shouldReplaceAgentAttentionReason — workflow source", () => {
	const reason = (
		source: "mcp" | "terminal" | "lifecycle" | "workflow",
		state: "waiting" | "ready" | "failed" | "active",
		reportedAt: number,
	) => ({ state, source, summary: "s", nextAction: null, reportedAt });

	it("same-source workflow: newer report wins regardless of rank", () => {
		expect(
			shouldReplaceAgentAttentionReason(
				reason("workflow", "waiting", 100),
				reason("workflow", "ready", 200),
			),
		).toBe(true);
	});

	it("same-source workflow: older report is ignored", () => {
		expect(
			shouldReplaceAgentAttentionReason(
				reason("workflow", "ready", 200),
				reason("workflow", "waiting", 100),
			),
		).toBe(false);
	});

	it("workflow vs other sources stays on the rank gate", () => {
		expect(
			shouldReplaceAgentAttentionReason(
				reason("terminal", "waiting", 100),
				reason("workflow", "active", 200),
			),
		).toBe(false);
	});
});
