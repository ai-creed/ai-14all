import { describe, it, expect } from "vitest";
import { detectAgentProvider } from "../../../src/features/workspace/logic/agent-provider-detection";

describe("detectAgentProvider", () => {
	it("identifies claude from command line", () => {
		expect(detectAgentProvider("claude --help", undefined, null)).toBe(
			"claude",
		);
		expect(detectAgentProvider("/usr/local/bin/claude", undefined, null)).toBe(
			"claude",
		);
	});

	it("identifies codex from command line", () => {
		expect(detectAgentProvider("codex --yolo", undefined, null)).toBe("codex");
	});

	it("identifies ezio and its ai-ezio alias from command line", () => {
		expect(detectAgentProvider("ezio", undefined, null)).toBe("ezio");
		expect(detectAgentProvider("ai-ezio --flag", undefined, null)).toBe("ezio");
		expect(detectAgentProvider("/usr/local/bin/ai-ezio", undefined, null)).toBe(
			"ezio",
		);
		expect(
			detectAgentProvider("whisper collab mount ezio", undefined, null),
		).toBe("ezio");
		expect(
			detectAgentProvider("whisper collab mount ai-ezio", undefined, null),
		).toBe("ezio");
	});

	it("identifies ezio (and the alias) from CLI title", () => {
		expect(detectAgentProvider("bash", "ezio", null)).toBe("ezio");
		expect(detectAgentProvider("bash", "ai-ezio session", null)).toBe("ezio");
	});

	it("returns null for unknown commands", () => {
		expect(detectAgentProvider("bash", undefined, null)).toBeNull();
		expect(detectAgentProvider("git status", undefined, null)).toBeNull();
	});

	it("uses CLI title as secondary when command is generic", () => {
		expect(detectAgentProvider("bash", "claude", null)).toBe("claude");
		expect(detectAgentProvider("bash", "codex session", null)).toBe("codex");
	});

	it("never downgrades an already-detected provider", () => {
		expect(detectAgentProvider("bash", "git pull", "claude")).toBe("claude");
		expect(detectAgentProvider("bash", "Pull latest commit", "codex")).toBe(
			"codex",
		);
	});

	it("command line wins over conflicting CLI title", () => {
		expect(detectAgentProvider("claude --help", "codex session", null)).toBe(
			"claude",
		);
	});

	it("returns null for non-agent commands when title hints something nonstandard", () => {
		expect(detectAgentProvider("python repl.py", undefined, null)).toBeNull();
	});

	it("does NOT match command substrings that are different tools", () => {
		expect(detectAgentProvider("claude-helper", undefined, null)).toBeNull();
		expect(detectAgentProvider("myclaude", undefined, null)).toBeNull();
		expect(
			detectAgentProvider("/opt/claudette/bin/x", undefined, null),
		).toBeNull();
		expect(detectAgentProvider("codex-wrapper", undefined, null)).toBeNull();
		expect(detectAgentProvider("ezio-helper", undefined, null)).toBeNull();
		expect(detectAgentProvider("myezio", undefined, null)).toBeNull();
		expect(detectAgentProvider("ai-ezio-helper", undefined, null)).toBeNull();
	});

	it("matches binary at a path basename", () => {
		expect(
			detectAgentProvider("/usr/local/bin/claude --flag", undefined, null),
		).toBe("claude");
		expect(
			detectAgentProvider("/home/u/.local/bin/codex", undefined, null),
		).toBe("codex");
	});

	it("currentProvider beats a conflicting label even when command is undefined", () => {
		expect(detectAgentProvider(undefined, "codex session", "claude")).toBe(
			"claude",
		);
	});

	it("accepts null command without coercion", () => {
		expect(detectAgentProvider(null, "claude", null)).toBe("claude");
		expect(detectAgentProvider(null, undefined, null)).toBeNull();
	});

	it("detects cursor from its `agent` launch command", () => {
		expect(detectAgentProvider("agent", undefined, null)).toBe("cursor");
		expect(
			detectAgentProvider("/Users/me/.local/bin/agent", undefined, null),
		).toBe("cursor");
	});

	it("detects antigravity from its `agy` launch command", () => {
		expect(detectAgentProvider("agy", undefined, null)).toBe("antigravity");
	});

	it("does not misfire `agent` on unrelated commands", () => {
		expect(detectAgentProvider("agentic-tool run", undefined, null)).toBeNull();
		expect(detectAgentProvider("my-agent", undefined, null)).toBeNull();
	});
});
