import type { ProcessAttentionState } from "../../../shared/models/process-session";

const actionRequiredPatterns = [
	/\bcontinue\?/i,
	/\b(?:y\/n|yes\/no)\b/i,
	/\berror:(?!\s*0\b)/i,
	/\bfailed\b/i,
	/\bexception\b/i,
];

export function deriveAttentionState(output: string): ProcessAttentionState {
	const text = output.trim();
	if (text.length === 0) return "idle";
	if (actionRequiredPatterns.some((pattern) => pattern.test(text))) {
		return "actionRequired";
	}
	return "activity";
}
