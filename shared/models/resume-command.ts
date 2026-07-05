import { AGENT_PROVIDERS } from "./agent-provider";

export const RESUME_COMMAND_MAX_LENGTH = 256;

/** Spec §5.5: strict character allowlist — every shell control operator and
 *  control character is unrepresentable, rather than enumerated. Widening this
 *  set is a deliberate schema change; never add characters with shell meaning. */
const ALLOWED = /^[A-Za-z0-9 ._/:=@-]+$/;

/** First-token allowlist for resume commands (validation only — the app never
 *  constructs resume commands; see spec D3). */
export const AGENT_BINARIES: readonly string[] = AGENT_PROVIDERS.map((p) => p.binary);

export type ResumeCommandValidation =
	| { ok: true }
	| { ok: false; reason: "empty" | "too_long" | "forbidden_characters" | "unknown_binary" };

export function validateResumeCommand(
	command: string,
	knownBinaries: readonly string[],
): ResumeCommandValidation {
	const trimmed = command.trim();
	if (trimmed.length === 0) return { ok: false, reason: "empty" };
	if (command.length > RESUME_COMMAND_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	if (!ALLOWED.test(command)) return { ok: false, reason: "forbidden_characters" };
	const firstToken = trimmed.split(" ")[0]!;
	if (!knownBinaries.includes(firstToken))
		return { ok: false, reason: "unknown_binary" };
	return { ok: true };
}
