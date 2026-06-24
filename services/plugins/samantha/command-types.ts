import { z } from "zod";

export const CommandFrameSchema = z.object({
	type: z.literal("command"),
	capabilityId: z.string(),
	requestId: z.string().min(1),
	// Zod 4 (repo uses ^4.3.6): z.record requires an explicit key type — the
	// single-arg z.record(z.unknown()) form throws at runtime. Mirror the existing
	// repo usage (shared/contracts/commands.ts:254): z.record(z.string(), z.unknown()).
	args: z.record(z.string(), z.unknown()).optional(),
	// S3: optional registration token presented on acting commands. Verified by
	// ActGuard FIRST; absent/invalid → unauthorized when acting is enabled.
	token: z.string().optional(),
});

export type CommandFrame = z.infer<typeof CommandFrameSchema>;

export const COMMAND_ERROR_CODES = [
	"unknown-capability",
	"unknown-worktree",
	"ambiguous-worktree",
	"invalid-args",
	"no-live-agent",
	"session-busy",
	"acting-disabled",
	"unauthorized",
	"internal",
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export type CommandResult =
	| {
			type: "commandResult";
			requestId: string;
			status: "ok";
			result: Record<string, unknown>;
	  }
	| {
			type: "commandResult";
			requestId: string;
			status: "error";
			error: { code: CommandErrorCode; message: string };
	  };

export function okResult(
	requestId: string,
	result: Record<string, unknown>,
): CommandResult {
	return { type: "commandResult", requestId, status: "ok", result };
}

export function errorResult(
	requestId: string,
	code: CommandErrorCode,
	message: string,
): CommandResult {
	return {
		type: "commandResult",
		requestId,
		status: "error",
		error: { code, message },
	};
}

export function serializeCommandResult(result: CommandResult): string {
	return JSON.stringify(result);
}

/**
 * Validate a raw inbound message. On failure, salvage a `requestId` if one is
 * structurally present so the caller can still return a correlated error; a
 * message with no recoverable `requestId` cannot be answered and is dropped.
 */
export function parseCommandFrame(
	raw: unknown,
): { ok: true; frame: CommandFrame } | { ok: false; requestId: string | null } {
	const parsed = CommandFrameSchema.safeParse(raw);
	if (parsed.success) return { ok: true, frame: parsed.data };
	const requestId =
		raw !== null &&
		typeof raw === "object" &&
		typeof (raw as { requestId?: unknown }).requestId === "string" &&
		(raw as { requestId: string }).requestId.length > 0
			? (raw as { requestId: string }).requestId
			: null;
	return { ok: false, requestId };
}
