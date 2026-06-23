import {
	type CommandErrorCode,
	type CommandFrame,
	type CommandResult,
	errorResult,
	okResult,
} from "./command-types";
import type { ResolveResult } from "./samantha-command-capabilities";

export type InstructOutcome =
	| { ok: true; routed: "collab-tell" | "workflow-resume" | "send-input" }
	| { ok: false; code: CommandErrorCode; message: string };

export type DispatcherCallbacks = {
	buildReport: () => Promise<string>;
	resolveWorktree: (key: string) => Promise<ResolveResult>;
	focusWorktree: (worktreeId: string) => void;
	instructSession: (
		args: Record<string, unknown> | undefined,
		token: string | undefined,
	) => Promise<InstructOutcome>;
};

export type CommandDispatcher = {
	dispatch: (frame: CommandFrame) => Promise<CommandResult>;
};

export function createSamanthaCommandDispatcher(
	cb: DispatcherCallbacks,
	opts: { log?: (message: string, error?: unknown) => void } = {},
): CommandDispatcher {
	async function dispatch(frame: CommandFrame): Promise<CommandResult> {
		try {
			if (frame.capabilityId === "session-report") {
				return okResult(frame.requestId, { report: await cb.buildReport() });
			}
			if (frame.capabilityId === "focus-worktree") {
				const key = frame.args?.worktree;
				if (typeof key !== "string" || key.length === 0)
					return errorResult(
						frame.requestId,
						"invalid-args",
						"focus-worktree requires args.worktree to be a non-empty string",
					);
				const resolved = await cb.resolveWorktree(key);
				if (resolved.kind === "none")
					return errorResult(
						frame.requestId,
						"unknown-worktree",
						`no worktree for "${key}"`,
					);
				if (resolved.kind === "ambiguous")
					return errorResult(
						frame.requestId,
						"ambiguous-worktree",
						`"${key}" matches ${resolved.candidates.length} worktrees: ${resolved.candidates.join(", ")}`,
					);
				cb.focusWorktree(resolved.worktreeId);
				return okResult(frame.requestId, { focused: key });
			}
			if (frame.capabilityId === "instruct-session") {
				// Forward raw args + token. Validation happens in the driver's prepare
				// thunk, AFTER ActGuard's token + acting-enabled gates (token-first).
				const outcome = await cb.instructSession(frame.args, frame.token);
				return outcome.ok
					? okResult(frame.requestId, { routed: outcome.routed })
					: errorResult(frame.requestId, outcome.code, outcome.message);
			}
			return errorResult(
				frame.requestId,
				"unknown-capability",
				`unknown capability "${frame.capabilityId}"`,
			);
		} catch (error) {
			// No stack leaks over the wire; log main-side only.
			opts.log?.("samantha command dispatch failed", error);
			return errorResult(frame.requestId, "internal", "capability failed");
		}
	}
	return { dispatch };
}
