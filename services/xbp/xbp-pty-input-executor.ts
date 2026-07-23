import {
	ptyInputCapability,
	type PtyInputArgs,
	type PtyInputErrorCode,
	type PtyInputResult,
} from "@ai-creed/command-contract";
import { translatePtyInputChunks } from "./pty-input-translate.js";
import type { PtyInputAuditEntry } from "../diagnostics/pty-input-audit-logger.js";

export type XbpPtyInputExecutor = {
	handle(args: PtyInputArgs): Promise<PtyInputResult>;
};

// Fixed generic refusal messages (child spec §3.1 Bug-2 analogue): bounded by
// construction, path-free, and NEVER interpolated from an error. The raw
// cause goes to logInternal (host-side) only.
const REFUSAL_MESSAGE: Record<PtyInputErrorCode, string> = {
	"pty-input-disabled": "pty input is disabled on the host",
	"no-such-pty": "unknown agent pty",
	"no-live-agent": "agent pty is not live",
	internal: "internal error during pty-input",
};

export function createXbpPtyInputExecutor(deps: {
	isPtyInputEnabled: () => boolean;
	resolvePty: (
		worktreeId: string,
		agentId: string,
	) => { terminalSessionId: string } | undefined;
	writeIfLive: (terminalSessionId: string, data: string) => boolean;
	auditPtyInput: (entry: PtyInputAuditEntry) => void;
	logInternal?: (detail: string) => void;
	now?: () => number;
}): XbpPtyInputExecutor {
	const now = deps.now ?? Date.now;

	// Input is atomic: ONE semantic entry per request, no start/result pair
	// (child spec §4). Both routes carry the full literal chunks.
	const audit = (
		args: PtyInputArgs,
		route: "apply" | "reject",
		rejectCode: PtyInputErrorCode | null,
	): void => {
		deps.auditPtyInput({
			ts: now(),
			channel: "xbp",
			capability: ptyInputCapability.id,
			worktreeId: args.worktreeId,
			agentId: args.agentId,
			route,
			rejectCode,
			chunks: args.chunks,
		});
	};

	const refuse = (
		args: PtyInputArgs,
		code: PtyInputErrorCode,
	): PtyInputResult => {
		audit(args, "reject", code);
		return { ok: false, code, message: REFUSAL_MESSAGE[code] };
	};

	return {
		// Contract: always returns a schema-valid PtyInputResult; never throws
		// for an expected refusal. An unexpected throw here becomes the Peer's
		// fail-closed handler-error → protocol `rejected`.
		async handle(args) {
			if (!deps.isPtyInputEnabled()) return refuse(args, "pty-input-disabled");

			const resolved = deps.resolvePty(args.worktreeId, args.agentId);
			if (!resolved) return refuse(args, "no-such-pty");

			const data = translatePtyInputChunks(args.chunks);
			let wrote: boolean;
			try {
				// Liveness is decided INSIDE this seam (child spec §3.1): the
				// catalog's `live` flag lags exit during mirror drain, so only the
				// terminal service's atomic check-and-write may gate the bytes.
				wrote = deps.writeIfLive(resolved.terminalSessionId, data);
			} catch (error) {
				deps.logInternal?.(
					error instanceof Error
						? (error.stack ?? error.message)
						: String(error),
				);
				return refuse(args, "internal");
			}
			if (!wrote) return refuse(args, "no-live-agent");

			audit(args, "apply", null);
			return { ok: true, appliedAt: now() };
		},
	};
}
