// tests/unit/workspace/resolve-worktree-observe-state.test.ts
import { describe, expect, it } from "vitest";
import { resolveWorktreeObserveState } from "../../../src/features/workspace/logic/resolve-worktree-observe-state";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import type { ProcessSession } from "../../../shared/models/process-session";

function session(partial: Partial<WorktreeSession>): WorktreeSession {
	return {
		id: "s1",
		worktreeId: "wt1",
		title: "t",
		note: "",
		reviewMode: "unified",
		filesPaneMode: "files",
		viewerMode: "diff",
		gitSummary: null,
		gitSummaryStale: false,
		gitSummaryMessage: null,
		gitSummaryError: false,
		selectedFilePath: null,
		selectedChangedFilePath: null,
		selectedCommitSha: null,
		selectedCommitFilePath: null,
		activeProcessSessionId: null,
		processSessionIds: [],
		attentionState: "none",
		agentAttentionReasons: {},
		terminalLayoutId: "single",
		slotProcessIds: [null],
		reviewSidebarWidth: 320,
		treeExpandedPaths: [],
		treeShowIgnored: false,
		task: null,
		pendingReveal: null,
		paneTransient: false,
		navLocation: null,
		...partial,
	} as WorktreeSession;
}

function proc(partial: Partial<ProcessSession>): ProcessSession {
	return {
		id: "p1",
		workspaceId: "w",
		worktreeId: "wt1",
		terminalSessionId: null,
		origin: "adHoc",
		presetId: null,
		label: "claude",
		command: "claude",
		status: "running",
		lastActivityAt: 1,
		lastOutputPreview: null,
		exitCode: null,
		pinned: false,
		attentionState: "none",
		agentAttentionReasons: {},
		agentAttentionClearedAt: null,
		agentDetected: true,
		provider: "claude",
		...partial,
	} as ProcessSession;
}

describe("resolveWorktreeObserveState", () => {
	it("returns idle defaults when there are no reasons", () => {
		const out = resolveWorktreeObserveState(session({}), {});
		expect(out.attention).toBe("idle");
		expect(out.summary).toBe("");
		expect(out.source).toBe("terminal");
	});

	it("picks the highest-ranked reason and its summary/source", () => {
		const out = resolveWorktreeObserveState(
			session({
				agentAttentionReasons: {
					mcp: {
						state: "waiting",
						source: "mcp",
						summary: "needs input",
						nextAction: "answer",
						reportedAt: 1234,
					},
				},
			}),
			{},
		);
		expect(out.attention).toBe("waiting");
		expect(out.summary).toBe("needs input");
		expect(out.nextAction).toBe("answer");
		expect(out.source).toBe("mcp");
		expect(out.updatedAt).toBe(1234);
	});

	it("session reason wins on equal-rank tie (terminal active vs mcp active)", () => {
		const out = resolveWorktreeObserveState(
			session({
				activeProcessSessionId: "p1",
				agentAttentionReasons: {
					mcp: {
						state: "active",
						source: "mcp",
						summary: "session-mcp-summary",
						nextAction: null,
						reportedAt: 20,
					},
				},
			}),
			{
				p1: proc({
					agentAttentionReasons: {
						terminal: {
							state: "active",
							source: "terminal",
							summary: "process-terminal-summary",
							nextAction: null,
							reportedAt: 10,
						},
					},
				}),
			},
		);
		expect(out.source).toBe("mcp");
		expect(out.summary).toBe("session-mcp-summary");
		expect(out.attention).toBe("active");
	});

	it("merges the active process reasons and ranks across both", () => {
		const out = resolveWorktreeObserveState(
			session({
				activeProcessSessionId: "p1",
				agentAttentionReasons: {
					mcp: {
						state: "active",
						source: "mcp",
						summary: "working",
						nextAction: null,
						reportedAt: 10,
					},
				},
			}),
			{
				p1: proc({
					agentAttentionReasons: {
						terminal: {
							state: "failed",
							source: "terminal",
							summary: "crashed",
							nextAction: null,
							reportedAt: 20,
						},
					},
				}),
			},
		);
		expect(out.attention).toBe("failed");
		expect(out.source).toBe("terminal");
		expect(out.provider).toBe("claude");
	});
});
