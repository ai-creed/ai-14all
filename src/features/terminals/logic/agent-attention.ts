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

function labelMatches(label: string): boolean {
	const trimmed = label.trim();
	return KNOWN_AGENTS.includes(trimmed as (typeof KNOWN_AGENTS)[number]);
}

export function isAgentProcess(
	label: string,
	command: string | null,
): boolean {
	if (command !== null) return commandMatches(command);
	return labelMatches(label);
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

export function classifyOutput(chunk: string): AgentAttentionState | null {
	const text = chunk.trim();
	if (text.length === 0) return null;
	if (WAITING_PATTERNS.some((p) => p.test(text))) return "waiting";
	if (FAILED_PATTERNS.some((p) => p.test(text))) return "failed";
	if (READY_PATTERNS.some((p) => p.test(text))) return "ready";
	return "active";
}

export function deriveStale(
	now: number,
	lastActivityAt: number | null,
	agentAttentionClearedAt: number | null,
): boolean {
	if (lastActivityAt === null) return false;
	if (now - lastActivityAt < STALE_THRESHOLD_MS) return false;
	if (agentAttentionClearedAt !== null && lastActivityAt <= agentAttentionClearedAt) {
		return false;
	}
	return true;
}

export function shouldReplaceAgentAttentionReason(
	current: AgentAttentionReason | undefined,
	next: AgentAttentionReason,
): boolean {
	if (!current) return true;
	return AGENT_ATTENTION_RANK[next.state] >= AGENT_ATTENTION_RANK[current.state];
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
