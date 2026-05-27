import type { UsageEvent } from "../../shared/models/usage.js";
import { claudeTokens, type ClaudeUsageRaw } from "./token-math.js";

export const CLAUDE_MARKER = '"usage"';

interface ClaudeLine {
	type?: unknown;
	timestamp?: unknown;
	cwd?: unknown;
	sessionId?: unknown;
	message?: { model?: unknown; usage?: ClaudeUsageRaw } | undefined;
}

export function parseClaudeLine(line: string): UsageEvent | null {
	if (!line.includes(CLAUDE_MARKER)) return null;
	let obj: ClaudeLine;
	try {
		obj = JSON.parse(line) as ClaudeLine;
	} catch {
		return null;
	}
	if (!obj || obj.type !== "assistant") return null;
	const usage = obj.message?.usage;
	if (!usage || typeof usage !== "object") return null;
	const timestampMs = Date.parse(
		typeof obj.timestamp === "string" ? obj.timestamp : "",
	);
	if (Number.isNaN(timestampMs)) return null;
	const t = claudeTokens(usage);
	return {
		provider: "claude",
		timestampMs,
		cwd: typeof obj.cwd === "string" ? obj.cwd : "",
		sessionId: typeof obj.sessionId === "string" ? obj.sessionId : "",
		model: typeof obj.message?.model === "string" ? obj.message.model : "",
		input: t.input,
		output: t.output,
		billable: t.billable,
		raw: t.raw,
	};
}
