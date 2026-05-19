import {
	AGENT_ATTENTION_RANK,
	STALE_THRESHOLD_MS,
	type AgentAttentionReason,
	type AgentAttentionReasonsBySource,
	type AgentAttentionState,
} from "../../../../shared/models/agent-attention";
import type { ProcessAttentionState } from "../../../../shared/models/process-session";

const KNOWN_AGENTS = ["codex", "claude", "claude-code"] as const;

function tokenize(command: string): string[] {
	return command
		.trim()
		.split(/\s+/)
		.filter((tok) => tok.length > 0);
}

function basenameLast(token: string): string {
	const slash = token.lastIndexOf("/");
	return slash === -1 ? token : token.slice(slash + 1);
}

function matchesKnownAgent(token: string): boolean {
	const base = basenameLast(token);
	for (const name of KNOWN_AGENTS) {
		if (base === name) return true;
		if (base.startsWith(`${name}-`)) {
			const suffix = base.slice(name.length + 1);
			if (/^\d+(\.\d+)*$/.test(suffix)) return true;
		}
	}
	return false;
}

function commandMatches(command: string): boolean {
	const tokens = tokenize(command);
	if (tokens.length === 0) return false;
	const head = tokens[0];
	if (basenameLast(head) === "npx") {
		const next = tokens[1];
		return next != null && matchesKnownAgent(next);
	}
	return matchesKnownAgent(head);
}

// When `command` is null (adHoc shells), the label may itself be a command-shaped
// string set via OSC title — e.g. "claude --print" or "/usr/local/bin/claude" —
// so it goes through the same first-token logic as `command`.
export function isAgentProcess(label: string, command: string | null): boolean {
	return commandMatches(command !== null ? command : label);
}

const WAITING_PATTERNS = [
	/\b(?:y\/n|yes\/no)\b/i,
	/\bcontinue\?/i,
	/\?\s*$/m,
	/\b(approve|permission|authori[sz]e)\b/i,
];
const FAILED_PATTERNS = [/\b(error|failed|exception)\b/i];
const READY_PATTERNS = [
	/\b(done|completed|complete)\b/i,
	/\bimplementation complete\b/i,
	/\bready for review\b/i,
	/\btests? (?:pass|passed)\b/i,
	/\ball checks passed\b/i,
];

/**
 * Telemetry hook for {@link classifyOutput}. Invoked ONLY when the classifier
 * produces a non-`active` actionable verdict (`waiting` | `failed` | `ready`);
 * never on neutral/active output or empty chunks. This non-active gate is the
 * throttle — `classifyOutput` runs per terminal chunk on a hot path, so the
 * emit must not fire on every chunk.
 *
 * The emit is purely additive: it does not change the return value or any
 * existing caller's behavior.
 */
export type ClassifierTelemetryEvent = {
	type: "classifier";
	// Only the non-active actionable verdicts are ever emitted. `stale` is part
	// of the IPC contract's classifier state union but is derived elsewhere
	// (deriveStale), never produced by classifyOutput — kept here so the emit
	// payload matches the channel contract without a cast at the callsite.
	state: Extract<AgentAttentionState, "waiting" | "ready" | "failed" | "stale">;
	matchedPattern: string;
	inputSample: string;
	inputPrev: string;
};

export type ClassifyOutputOptions = {
	emit?: (event: ClassifierTelemetryEvent) => void;
};

function firstMatch(patterns: readonly RegExp[], text: string): RegExp | null {
	for (const p of patterns) {
		if (p.test(text)) return p;
	}
	return null;
}

// Claude Code (and similar TUIs) render a persistent mode footer line such as
// "⏵⏵ bypass permissions on (shift+tab to cycle)" / "⏵⏵ accept edits on (…)" /
// "⏸ plan mode on (…)". It repaints on every redraw even while the agent sits
// idle at the prompt. Classifying that chrome as `active` pins the process at
// "activity" forever (the perpetual-cooking card). The "(shift+tab to cycle)"
// suffix is the stable signature across all three modes. Strip those lines
// before classifying so a redraw-only chunk yields no signal (null). RC2
// (MCP supersede) is the backstop if the footer wording ever drifts.
const MODE_FOOTER_LINE = /\(\s*shift\s*\+\s*tab to cycle\s*\)/i;

function stripModeFooter(chunk: string): string {
	return chunk
		.split("\n")
		.filter((line) => !MODE_FOOTER_LINE.test(line))
		.join("\n");
}

export function classifyOutput(
	chunk: string,
	options?: ClassifyOutputOptions,
): AgentAttentionState | null {
	const text = stripModeFooter(chunk).trim();
	if (text.length === 0) return null;

	const waiting = firstMatch(WAITING_PATTERNS, text);
	const failed = waiting ? null : firstMatch(FAILED_PATTERNS, text);
	const ready = waiting || failed ? null : firstMatch(READY_PATTERNS, text);

	let state: ClassifierTelemetryEvent["state"];
	let matched: RegExp;
	if (waiting) {
		state = "waiting";
		matched = waiting;
	} else if (failed) {
		state = "failed";
		matched = failed;
	} else if (ready) {
		state = "ready";
		matched = ready;
	} else {
		return "active";
	}

	// Reached only on a non-active actionable verdict — the hot-path throttle.
	options?.emit?.({
		type: "classifier",
		state,
		matchedPattern: matched.source,
		inputSample: chunk.slice(0, 500),
		inputPrev: "",
	});

	return state;
}

export function deriveStale(
	now: number,
	lastActivityAt: number | null,
	agentAttentionClearedAt: number | null,
): boolean {
	if (lastActivityAt === null) return false;
	if (now - lastActivityAt < STALE_THRESHOLD_MS) return false;
	if (
		agentAttentionClearedAt !== null &&
		lastActivityAt <= agentAttentionClearedAt
	) {
		return false;
	}
	return true;
}

export function shouldReplaceAgentAttentionReason(
	current: AgentAttentionReason | undefined,
	next: AgentAttentionReason,
): boolean {
	if (!current) return true;
	// Same-source MCP pushes overwrite without the rank gate: the agent
	// explicitly reports its own state via MCP, so its latest report
	// supersedes its prior one. Ties (equal reportedAt) replace too; an
	// older report is ignored. The terminal/lifecycle classifiers stay on
	// the rank gate — their heuristic "active" output must not clobber a
	// live "waiting" prompt detected earlier.
	if (current.source === "mcp" && next.source === "mcp") {
		return next.reportedAt >= current.reportedAt;
	}
	return (
		AGENT_ATTENTION_RANK[next.state] >= AGENT_ATTENTION_RANK[current.state]
	);
}

export function rankAgentAttention(
	reasons: AgentAttentionReasonsBySource,
	derivedStale: boolean,
): AgentAttentionState {
	let best: AgentAttentionState = "idle";
	const candidates: AgentAttentionState[] = [];
	for (const r of Object.values(reasons)) {
		if (r) candidates.push(r.state);
	}
	if (derivedStale) candidates.push("stale");
	for (const s of candidates) {
		if (AGENT_ATTENTION_RANK[s] > AGENT_ATTENTION_RANK[best]) best = s;
	}
	return best;
}

export function mapToProcessAttentionState(
	state: AgentAttentionState,
): ProcessAttentionState {
	if (state === "waiting" || state === "failed") return "actionRequired";
	if (state === "idle") return "idle";
	return "activity";
}
