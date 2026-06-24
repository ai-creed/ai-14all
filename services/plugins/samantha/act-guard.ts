import type { ActingAuditEntry } from "../../diagnostics/acting-audit-logger";
import type { RouteDecision } from "./session-instruction-router";

export type PrepResult =
	| {
			ok: true;
			worktreeId: string;
			instruction: string;
			decision: RouteDecision;
	  }
	| {
			ok: false;
			code: "invalid-args" | "unknown-worktree" | "ambiguous-worktree";
			message: string;
	  };

export type ActOutcome =
	| { ok: true; routed: "collab-tell" | "workflow-resume" | "send-input" }
	| {
			ok: false;
			code:
				| "unauthorized"
				| "acting-disabled"
				| "invalid-args"
				| "unknown-worktree"
				| "ambiguous-worktree"
				| "no-live-agent"
				| "session-busy"
				| "internal";
			message: string;
	  };

export type ExecuteFn = (
	worktreeId: string,
	decision: RouteDecision,
) => Promise<{ ok: boolean; detail: string }>;

export type ActGuardDeps = {
	verifyToken: (token: string | undefined) => boolean;
	isActingEnabled: () => boolean;
	execute: ExecuteFn;
	audit: (entry: ActingAuditEntry) => void;
	now?: () => number;
};

export function createActGuard(deps: ActGuardDeps): {
	run(input: {
		token: string | undefined;
		prepare: () => Promise<PrepResult>;
	}): Promise<ActOutcome>;
} {
	const now = deps.now ?? Date.now;
	return {
		async run(input) {
			const ts = now();

			// Gate 1: token FIRST. No args/worktree work happens before this, so an
			// unauthenticated caller learns nothing.
			if (!deps.verifyToken(input.token)) {
				deps.audit({
					phase: "result",
					ts,
					worktreeId: "",
					instruction: "",
					route: "reject",
					guard: { tokenValid: false, actingEnabled: false },
					rejectCode: "unauthorized",
					result: { ok: false, detail: "invalid token" },
				});
				return { ok: false, code: "unauthorized", message: "invalid token" };
			}

			// Gate 2: acting-enabled, still before any prepare()/worktree exposure.
			if (!deps.isActingEnabled()) {
				deps.audit({
					phase: "result",
					ts,
					worktreeId: "",
					instruction: "",
					route: "reject",
					guard: { tokenValid: true, actingEnabled: false },
					rejectCode: "acting-disabled",
					result: { ok: false, detail: "acting disabled" },
				});
				return { ok: false, code: "acting-disabled", message: "acting is disabled" };
			}

			const guard = { tokenValid: true, actingEnabled: true };
			const prep = await input.prepare();
			if (!prep.ok) {
				deps.audit({
					phase: "result",
					ts,
					worktreeId: "",
					instruction: "",
					route: "reject",
					guard,
					rejectCode: prep.code,
					result: { ok: false, detail: prep.message },
				});
				return { ok: false, code: prep.code, message: prep.message };
			}

			if (prep.decision.kind === "reject") {
				deps.audit({
					phase: "result",
					ts,
					worktreeId: prep.worktreeId,
					instruction: prep.instruction,
					route: "reject",
					guard,
					rejectCode: prep.decision.code,
					result: { ok: false, detail: prep.decision.reason },
				});
				return {
					ok: false,
					code: prep.decision.code,
					message: prep.decision.reason,
				};
			}

			// Executing path: audit start, execute, audit result. The result audit
			// MUST fire for every outcome, so a thrown/rejected execute is converted
			// into an ok:false result here rather than propagating past the chokepoint
			// — otherwise the result audit is skipped and the "every outcome recorded"
			// guarantee breaks (e.g. a stale unmanaged sessionId makes the PTY
			// sendInput throw).
			deps.audit({
				phase: "start",
				ts,
				worktreeId: prep.worktreeId,
				instruction: prep.instruction,
				route: prep.decision.kind,
				guard,
				rejectCode: null,
				result: null,
			});
			let result: { ok: boolean; detail: string };
			try {
				result = await deps.execute(prep.worktreeId, prep.decision);
			} catch (error) {
				result = {
					ok: false,
					detail: error instanceof Error ? error.message : String(error),
				};
			}
			deps.audit({
				phase: "result",
				ts: now(),
				worktreeId: prep.worktreeId,
				instruction: prep.instruction,
				route: prep.decision.kind,
				guard,
				rejectCode: null,
				result,
			});
			if (!result.ok)
				return { ok: false, code: "internal", message: result.detail };
			return { ok: true, routed: prep.decision.kind };
		},
	};
}
