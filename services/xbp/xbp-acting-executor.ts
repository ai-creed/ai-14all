import {
	pauseSessionCapability,
	resumeSessionCapability,
	stopSessionCapability,
	type LifecycleErrorCode,
	type LifecycleResult,
} from "@ai-creed/command-contract";
import type {
	WhisperCommand,
	WhisperCommandResult,
} from "../../shared/contracts/plugins.js";
import type { WhisperWorktreeState } from "../../shared/models/ecosystem-plugin.js";
import type { ActingAuditEntry } from "../diagnostics/acting-audit-logger.js";

export type WorkflowRef = {
	workspaceId: string;
	worktreeId: string;
	workflowId: string;
	cwd: string;
};

export type ResolveResult =
	| { ok: true; ref: WorkflowRef }
	| { ok: false; code: LifecycleErrorCode; message?: string };

// worktreeId → the worktree's active managed whisper workflow. Fail-closed:
// refusals are returned, never thrown, and ambiguity never guesses a target.
export function createWorkflowResolver(deps: {
	getWhisperStates: () =>
		| Promise<WhisperWorktreeState[]>
		| WhisperWorktreeState[];
	resolveWorktreeRef: (
		worktreeId: string,
	) => Promise<{ workspaceId: string; cwd: string } | null>;
}): (worktreeId: string) => Promise<ResolveResult> {
	return async (worktreeId) => {
		const ref = await deps.resolveWorktreeRef(worktreeId);
		if (ref === null)
			return {
				ok: false,
				code: "unknown-worktree",
				message: "worktree not resolved",
			};
		const matches = (await deps.getWhisperStates()).filter(
			(s) => s.worktreeId === worktreeId,
		);
		if (matches.length > 1)
			return {
				ok: false,
				code: "ambiguous-worktree",
				message: `${matches.length} collab states for worktree`,
			};
		const state = matches[0];
		// Same liveness rule the samantha router uses (session-instruction-router.ts).
		if (!state || !state.daemonAlive || state.workflow === null)
			return {
				ok: false,
				code: "no-live-agent",
				message: "no live managed workflow",
			};
		return {
			ok: true,
			ref: {
				workspaceId: ref.workspaceId,
				worktreeId,
				workflowId: state.workflow.workflowId,
				cwd: ref.cwd,
			},
		};
	};
}

export type XbpActingExecutor = {
	pause(worktreeId: string): Promise<LifecycleResult>;
	resume(worktreeId: string): Promise<LifecycleResult>;
	stop(worktreeId: string): Promise<LifecycleResult>;
};

type LifecycleRoute = "workflow-pause" | "workflow-resume" | "workflow-cancel";

export function createXbpActingExecutor(deps: {
	isActingEnabled: () => boolean;
	resolveWorkflow: (worktreeId: string) => Promise<ResolveResult>;
	runWhisperCommand: (
		command: WhisperCommand,
		cwd: string,
	) => Promise<WhisperCommandResult>;
	auditAct: (entry: ActingAuditEntry) => void;
	now?: () => number;
}): XbpActingExecutor {
	const now = deps.now ?? Date.now;

	// Decision 7: a refusal writes a SINGLE reject `result` entry (samantha
	// gate-denial convention); an executed operation writes a start/result pair.
	const refuse = (
		capabilityId: string,
		worktreeId: string,
		actingEnabled: boolean,
		code: LifecycleErrorCode,
		message: string,
	): LifecycleResult => {
		deps.auditAct({
			phase: "result",
			ts: now(),
			channel: "xbp",
			worktreeId,
			instruction: capabilityId,
			route: "reject",
			guard: { tokenValid: true, actingEnabled },
			rejectCode: code,
			result: { ok: false, detail: message },
		});
		return { ok: false, code, message };
	};

	const run = async (
		capabilityId: string,
		route: LifecycleRoute,
		successState: "paused" | "running" | "stopped",
		worktreeId: string,
		buildCommand: (ref: WorkflowRef) => WhisperCommand,
	): Promise<LifecycleResult> => {
		if (!deps.isActingEnabled())
			return refuse(
				capabilityId,
				worktreeId,
				false,
				"acting-disabled",
				"acting is disabled",
			);
		const resolved = await deps.resolveWorkflow(worktreeId);
		if (!resolved.ok)
			return refuse(
				capabilityId,
				worktreeId,
				true,
				resolved.code,
				resolved.message ?? resolved.code,
			);
		const { ref } = resolved;
		const guard = { tokenValid: true, actingEnabled: true };
		deps.auditAct({
			phase: "start",
			ts: now(),
			channel: "xbp",
			worktreeId,
			instruction: capabilityId,
			route,
			guard,
			rejectCode: null,
			result: null,
		});
		// The runner resolves { ok:false } on failure and only throws on
		// unexpected faults; both map to code:"internal" — the handler must
		// always return a schema-valid LifecycleResult, never throw.
		let outcome: { ok: boolean; detail: string };
		try {
			const r = await deps.runWhisperCommand(buildCommand(ref), ref.cwd);
			outcome = {
				ok: r.ok,
				detail: r.ok
					? "applied"
					: r.stderr.slice(0, 200) || `exit ${r.exitCode}`,
			};
		} catch (error) {
			outcome = {
				ok: false,
				detail: error instanceof Error ? error.message : String(error),
			};
		}
		deps.auditAct({
			phase: "result",
			ts: now(),
			channel: "xbp",
			worktreeId,
			instruction: capabilityId,
			route,
			guard,
			rejectCode: null,
			result: outcome,
		});
		if (!outcome.ok)
			return { ok: false, code: "internal", message: outcome.detail };
		return {
			ok: true,
			worktreeId,
			workflowId: ref.workflowId,
			state: successState,
			appliedAt: new Date(now()).toISOString(),
		};
	};

	return {
		pause: (worktreeId) =>
			run(
				pauseSessionCapability.id,
				"workflow-pause",
				"paused",
				worktreeId,
				(ref) => ({
					kind: "workflow-pause",
					workspaceId: ref.workspaceId,
					worktreeId: ref.worktreeId,
					workflowId: ref.workflowId,
				}),
			),
		resume: (worktreeId) =>
			run(
				resumeSessionCapability.id,
				"workflow-resume",
				"running",
				worktreeId,
				(ref) => ({
					kind: "workflow-resume",
					workspaceId: ref.workspaceId,
					worktreeId: ref.worktreeId,
					workflowId: ref.workflowId,
					message: null,
				}),
			),
		stop: (worktreeId) =>
			run(
				stopSessionCapability.id,
				"workflow-cancel",
				"stopped",
				worktreeId,
				(ref) => ({
					kind: "workflow-cancel",
					workspaceId: ref.workspaceId,
					worktreeId: ref.worktreeId,
					workflowId: ref.workflowId,
				}),
			),
	};
}
