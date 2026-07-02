import { describe, it, expect, vi } from "vitest";
import type { ActingAuditEntry } from "../../../services/diagnostics/acting-audit-logger";
import {
	createWorkflowResolver,
	createXbpActingExecutor,
	type ResolveResult,
} from "../../../services/xbp/xbp-acting-executor";

const liveState = {
	worktreeId: "wt-1",
	collabId: "c1",
	daemonAlive: true,
	liveFeed: "socket" as const,
	bindings: [],
	workflow: {
		workflowId: "wf-1",
		workflowType: "sdd",
		specPath: "s.md",
		status: "running",
		currentPhaseIndex: 0,
		phaseName: null,
		currentChainId: null,
		round: null,
		haltReason: null,
		updatedAt: "2026-07-02T00:00:00.000Z",
	},
	escalation: null,
	handoffs: [],
};

function makeExecutor(overrides?: {
	actingEnabled?: boolean;
	resolve?: (worktreeId: string) => Promise<ResolveResult>;
	runOk?: boolean;
	runThrows?: boolean;
}) {
	const entries: ActingAuditEntry[] = [];
	const run = vi.fn(async () =>
		overrides?.runThrows
			? Promise.reject(new Error("spawn failed"))
			: {
					ok: overrides?.runOk ?? true,
					exitCode: overrides?.runOk === false ? 1 : 0,
					stdout: "",
					stderr: overrides?.runOk === false ? "boom" : "",
				},
	);
	const executor = createXbpActingExecutor({
		isActingEnabled: () => overrides?.actingEnabled ?? true,
		resolveWorkflow:
			overrides?.resolve ??
			(async () => ({
				ok: true as const,
				ref: {
					workspaceId: "ws-1",
					worktreeId: "wt-1",
					workflowId: "wf-1",
					cwd: "/tmp/wt-1",
				},
			})),
		runWhisperCommand: run,
		auditAct: (e) => entries.push(e),
		now: () => 1_751_400_000_000,
	});
	return { executor, run, entries };
}

describe("createWorkflowResolver", () => {
	it("returns unknown-worktree when the worktree ref does not resolve", async () => {
		const resolve = createWorkflowResolver({
			getWhisperStates: () => [],
			resolveWorktreeRef: async () => null,
		});
		const result = await resolve("wt-x");
		expect(result).toMatchObject({ ok: false, code: "unknown-worktree" });
	});

	it("returns no-live-agent when there is no live managed workflow", async () => {
		const resolveWorktreeRef = async () => ({
			workspaceId: "ws-1",
			cwd: "/tmp/wt-1",
		});

		const noStates = createWorkflowResolver({
			getWhisperStates: () => [],
			resolveWorktreeRef,
		});
		expect(await noStates("wt-1")).toMatchObject({
			ok: false,
			code: "no-live-agent",
		});

		const deadDaemon = createWorkflowResolver({
			getWhisperStates: () => [{ ...liveState, daemonAlive: false }],
			resolveWorktreeRef,
		});
		expect(await deadDaemon("wt-1")).toMatchObject({
			ok: false,
			code: "no-live-agent",
		});

		const noWorkflow = createWorkflowResolver({
			getWhisperStates: () => [{ ...liveState, workflow: null }],
			resolveWorktreeRef,
		});
		expect(await noWorkflow("wt-1")).toMatchObject({
			ok: false,
			code: "no-live-agent",
		});
	});

	it("returns ambiguous-worktree when two states share the same worktreeId", async () => {
		const resolve = createWorkflowResolver({
			getWhisperStates: () => [liveState, { ...liveState, collabId: "c2" }],
			resolveWorktreeRef: async () => ({
				workspaceId: "ws-1",
				cwd: "/tmp/wt-1",
			}),
		});
		const result = await resolve("wt-1");
		expect(result).toMatchObject({ ok: false, code: "ambiguous-worktree" });
	});

	it("resolves the workflow ref on the happy path", async () => {
		const resolve = createWorkflowResolver({
			getWhisperStates: () => [liveState],
			resolveWorktreeRef: async () => ({
				workspaceId: "ws-1",
				cwd: "/tmp/wt-1",
			}),
		});
		const result = await resolve("wt-1");
		expect(result).toEqual({
			ok: true,
			ref: {
				workspaceId: "ws-1",
				worktreeId: "wt-1",
				workflowId: "wf-1",
				cwd: "/tmp/wt-1",
			},
		});
	});
});

describe("createXbpActingExecutor", () => {
	it("acting disabled: refuses without calling the runner and writes exactly one reject entry", async () => {
		const { executor, run, entries } = makeExecutor({ actingEnabled: false });

		const result = await executor.pause("wt-1");

		expect(result).toEqual({
			ok: false,
			code: "acting-disabled",
			message: "acting is disabled",
		});
		expect(run).not.toHaveBeenCalled();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toEqual({
			phase: "result",
			ts: 1_751_400_000_000,
			channel: "xbp",
			worktreeId: "wt-1",
			instruction: "xavier.control.pause-session",
			route: "reject",
			guard: { tokenValid: true, actingEnabled: false },
			rejectCode: "acting-disabled",
			result: { ok: false, detail: "acting is disabled" },
		});
	});

	it("resolution refusal surfaces verbatim, no runner call, one reject entry", async () => {
		const { executor, run, entries } = makeExecutor({
			resolve: async () => ({ ok: false, code: "no-live-agent" }),
		});

		const result = await executor.pause("wt-1");

		expect(result).toMatchObject({ ok: false, code: "no-live-agent" });
		expect(run).not.toHaveBeenCalled();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			phase: "result",
			channel: "xbp",
			route: "reject",
			rejectCode: "no-live-agent",
			guard: { tokenValid: true, actingEnabled: true },
		});
	});

	it("pause happy path: runs the whisper command and writes a start/result pair", async () => {
		const { executor, run, entries } = makeExecutor();

		const result = await executor.pause("wt-1");

		expect(run).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledWith(
			{
				kind: "workflow-pause",
				workspaceId: "ws-1",
				worktreeId: "wt-1",
				workflowId: "wf-1",
			},
			"/tmp/wt-1",
		);
		expect(result).toEqual({
			ok: true,
			worktreeId: "wt-1",
			workflowId: "wf-1",
			state: "paused",
			appliedAt: new Date(1_751_400_000_000).toISOString(),
		});
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			phase: "start",
			channel: "xbp",
			route: "workflow-pause",
			rejectCode: null,
		});
		expect(entries[1]).toMatchObject({
			phase: "result",
			channel: "xbp",
			route: "workflow-pause",
			rejectCode: null,
			result: { ok: true },
		});
	});

	it("resume sends message:null and the workflow-resume route; stop sends workflow-cancel", async () => {
		const resume = makeExecutor();
		const resumeResult = await resume.executor.resume("wt-1");
		expect(resume.run).toHaveBeenCalledWith(
			{
				kind: "workflow-resume",
				workspaceId: "ws-1",
				worktreeId: "wt-1",
				workflowId: "wf-1",
				message: null,
			},
			"/tmp/wt-1",
		);
		expect(resumeResult).toMatchObject({ ok: true, state: "running" });
		expect(resume.entries.map((e) => e.route)).toEqual([
			"workflow-resume",
			"workflow-resume",
		]);

		const stop = makeExecutor();
		const stopResult = await stop.executor.stop("wt-1");
		expect(stop.run).toHaveBeenCalledWith(
			{
				kind: "workflow-cancel",
				workspaceId: "ws-1",
				worktreeId: "wt-1",
				workflowId: "wf-1",
			},
			"/tmp/wt-1",
		);
		expect(stopResult).toMatchObject({ ok: true, state: "stopped" });
		expect(stop.entries.map((e) => e.route)).toEqual([
			"workflow-cancel",
			"workflow-cancel",
		]);
	});

	it("runner reports ok:false: maps to code:internal, keeps the start/result pair, rejectCode stays null", async () => {
		const { executor, entries } = makeExecutor({ runOk: false });

		const result = await executor.pause("wt-1");

		expect(result).toEqual({ ok: false, code: "internal", message: "boom" });
		expect(entries).toHaveLength(2);
		expect(entries[0].phase).toBe("start");
		expect(entries[1]).toMatchObject({
			phase: "result",
			route: "workflow-pause",
			rejectCode: null,
			result: { ok: false, detail: "boom" },
		});
	});

	it("runner throws: caught and mapped to code:internal without rejecting the promise", async () => {
		const { executor, entries } = makeExecutor({ runThrows: true });

		await expect(executor.pause("wt-1")).resolves.toEqual({
			ok: false,
			code: "internal",
			message: "spawn failed",
		});
		expect(entries).toHaveLength(2);
		expect(entries[0].phase).toBe("start");
		expect(entries[1]).toMatchObject({
			phase: "result",
			route: "workflow-pause",
			rejectCode: null,
			result: { ok: false, detail: "spawn failed" },
		});
	});
});
