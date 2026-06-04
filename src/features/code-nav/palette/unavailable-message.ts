import type { WorktreeStatusPayload } from "../../../../shared/contracts/commands.js";

type Reason = WorktreeStatusPayload["reason"];

/** Maps an unavailable status reason to user-facing copy (null = available). */
export function unavailableMessage(reason: Reason): string | null {
	switch (reason) {
		case "unsupported-schema":
			return "Update ai-cortex to enable code navigation.";
		case "no-cortex":
		case "not-indexed":
			return "Install ai-cortex ≥ 0.13 to enable code navigation.";
		default:
			return null;
	}
}
