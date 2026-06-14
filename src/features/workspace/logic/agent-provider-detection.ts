import type { AgentProvider } from "../../../../shared/models/agent-attention";

// A "command token" is the binary name at start-of-string, or right after a
// path separator or whitespace, terminated by whitespace or end-of-string.
// `(?:^|[\s/\\])` anchors to a real boundary (NOT a generic `\b`, which would
// treat `-` as a boundary); `(?=\s|$)` requires the token to end at whitespace
// or EOS, so `claude-helper`, `myclaude`, `claudette` all fail.
const CLAUDE_COMMAND = /(?:^|[\s/\\])claude(?=\s|$)/i;
const CODEX_COMMAND = /(?:^|[\s/\\])codex(?=\s|$)/i;
// `ezio` ships under two binary names — `ezio` and the `ai-ezio` alias — so the
// optional `ai-` prefix matches both, while the boundary/lookahead still reject
// `myezio`, `ezio-helper`, and `ai-ezio-helper`.
const EZIO_COMMAND = /(?:^|[\s/\\])(?:ai-)?ezio(?=\s|$)/i;

function matchCommand(
	command: string | null | undefined,
): AgentProvider | null {
	if (!command) return null;
	if (CLAUDE_COMMAND.test(command)) return "claude";
	if (CODEX_COMMAND.test(command)) return "codex";
	if (EZIO_COMMAND.test(command)) return "ezio";
	return null;
}

// Titles are freeform; an agent may set its terminal title to "claude" or
// "Claude Code", so a word-boundary match is the right looseness here.
function matchLabel(label: string | undefined): AgentProvider | null {
	if (!label) return null;
	if (/\bclaude\b/i.test(label)) return "claude";
	if (/\bcodex\b/i.test(label)) return "codex";
	// `\bezio\b` already matches the `ai-ezio` alias: the hyphen is a word
	// boundary, so "ai-ezio" contains the standalone token "ezio".
	if (/\bezio\b/i.test(label)) return "ezio";
	return null;
}

// Returns "claude" | "codex" | "ezio" | null. Never emits "other" — that bucket is set by other code paths, not command/label sniffing.
/**
 * Detect the agent provider for a process. Sticky behavior:
 *
 * - Command-line match is the primary signal. Once detected, never downgraded.
 * - CLI title is a secondary hint. Only promotes a previously-null provider.
 * - Existing detected provider always wins over CLI title to prevent
 *   transient title strings (e.g. "git pull") from overwriting true identity.
 */
export function detectAgentProvider(
	command: string | null | undefined,
	label: string | undefined,
	currentProvider: AgentProvider | null,
): AgentProvider | null {
	const fromCommand = matchCommand(command);
	if (fromCommand) return fromCommand;

	if (currentProvider) return currentProvider;

	return matchLabel(label);
}
