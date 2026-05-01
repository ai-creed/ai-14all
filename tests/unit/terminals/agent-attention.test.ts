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
