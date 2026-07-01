import { describe, expect, it } from "vitest";
import {
	buildWorktreeAttentionDisplay,
	buildWorktreeProcessSummary,
	formatQuietAge,
	formatRelativeQuiet,
} from "../../../src/features/workspace/logic/sidebar-shell-summary";
import { STALE_THRESHOLD_MS } from "../../../shared/models/agent-attention";
import type { AgentAttentionReason } from "../../../shared/models/agent-attention";

const now = 20_000;

describe("formatQuietAge", () => {
	it("formats quiet age in whole seconds", () => {
		expect(formatQuietAge(14_900)).toBe("quiet 14s");
	});
});

describe("formatRelativeQuiet", () => {
	it("formats seconds, minutes, hours, days", () => {
		expect(formatRelativeQuiet(5_000)).toBe("quiet 5s");
		expect(formatRelativeQuiet(180_000)).toBe("quiet 3m");
		expect(formatRelativeQuiet(5 * 3_600_000)).toBe("quiet 5h");
		expect(formatRelativeQuiet(2 * 86_400_000)).toBe("quiet 2d");
	});
	it("floors sub-second to 1s", () => {
		expect(formatRelativeQuiet(0)).toBe("quiet 1s");
	});
});

describe("buildWorktreeProcessSummary", () => {
	it("derives action required, active, idle, and exited rows", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "claude",
					status: "running",
					attentionState: "actionRequired",
					lastActivityAt: 19_000,
					lastOutputPreview: "Continue? [y/N]",
					exitCode: null,
				},
				{
					id: "p2",
					label: "dev",
					status: "running",
					attentionState: "activity",
					lastActivityAt: 19_500,
					lastOutputPreview: "compiled in 124ms",
					exitCode: null,
				},
				{
					id: "p3",
					label: "tests",
					status: "running",
					attentionState: "idle",
					lastActivityAt: 8_000,
					lastOutputPreview: "old preview",
					exitCode: null,
				},
				{
					id: "p4",
					label: "lint",
					status: "exited",
					attentionState: "idle",
					lastActivityAt: 10_000,
					lastOutputPreview: "done",
					exitCode: 1,
				},
			],
			now,
			4,
		);

		// Rows keep their input (creation) order; severity no longer reorders them.
		expect(
			summary.rows.map((row) => [row.label, row.state, row.context]),
		).toEqual([
			["claude", "actionRequired", "Continue? [y/N]"],
			["dev", "active", "compiled in 124ms"],
			["tests", "idle", "quiet 12s"],
			["lint", "exited", "exit 1"],
		]);
	});

	it("keeps rows in input order regardless of state changes", () => {
		const build = () =>
			buildWorktreeProcessSummary(
				[
					{
						id: "claude",
						label: "claude",
						status: "running",
						attentionState: "idle",
						lastActivityAt: 8_000,
						lastOutputPreview: "idle",
						exitCode: null,
					},
					{
						id: "codex",
						label: "codex",
						status: "running",
						attentionState: "actionRequired",
						lastActivityAt: 19_000,
						lastOutputPreview: "Continue? [y/N]",
						exitCode: null,
					},
				],
				now,
				4,
			);

		// codex is the more severe / more recent process, but the visible rows
		// must stay in the order the processes were created (claude, codex) so the
		// sidebar list does not shuffle as agents change state simultaneously.
		expect(build().rows.map((row) => row.label)).toEqual(["claude", "codex"]);
	});

	it("exposes the most-severe process as topRow without reordering rows", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "claude",
					label: "claude",
					status: "running",
					attentionState: "idle",
					lastActivityAt: 8_000,
					lastOutputPreview: "idle",
					exitCode: null,
				},
				{
					id: "codex",
					label: "codex",
					status: "running",
					attentionState: "actionRequired",
					lastActivityAt: 19_000,
					lastOutputPreview: "Continue? [y/N]",
					exitCode: null,
				},
			],
			now,
			4,
		);

		expect(summary.rows.map((row) => row.label)).toEqual(["claude", "codex"]);
		expect(summary.topRow?.label).toBe("codex");
		expect(summary.topRow?.state).toBe("actionRequired");
	});

	it("topRow tie-breaks on recency within the same severity", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "older",
					label: "older",
					status: "running",
					attentionState: "activity",
					lastActivityAt: 12_000,
					lastOutputPreview: "old",
					exitCode: null,
				},
				{
					id: "newer",
					label: "newer",
					status: "running",
					attentionState: "activity",
					lastActivityAt: 19_000,
					lastOutputPreview: "new",
					exitCode: null,
				},
			],
			now,
			4,
		);

		expect(summary.rows.map((row) => row.label)).toEqual(["older", "newer"]);
		expect(summary.topRow?.label).toBe("newer");
	});

	it("caps visible rows and reports overflow", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "one",
					status: "running",
					attentionState: "activity",
					lastActivityAt: 19_000,
					lastOutputPreview: "one",
					exitCode: null,
				},
				{
					id: "p2",
					label: "two",
					status: "running",
					attentionState: "activity",
					lastActivityAt: 18_000,
					lastOutputPreview: "two",
					exitCode: null,
				},
				{
					id: "p3",
					label: "three",
					status: "running",
					attentionState: "activity",
					lastActivityAt: 17_000,
					lastOutputPreview: "three",
					exitCode: null,
				},
				{
					id: "p4",
					label: "four",
					status: "running",
					attentionState: "activity",
					lastActivityAt: 16_000,
					lastOutputPreview: "four",
					exitCode: null,
				},
			],
			now,
			3,
		);

		expect(summary.rows).toHaveLength(3);
		expect(summary.overflowCount).toBe(1);
	});

	it("reports stale context when running, quiet past threshold, not yet cleared", () => {
		const staleNow = STALE_THRESHOLD_MS + 1_000;
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "claude",
					status: "running",
					attentionState: "idle",
					lastActivityAt: 0,
					lastOutputPreview: null,
					exitCode: null,
					agentAttentionReasons: {},
					agentAttentionClearedAt: null,
				},
			],
			staleNow,
		);
		expect(summary.rows[0].context).toContain("stale");
	});

	it("does not report stale when agentAttentionClearedAt >= lastActivityAt", () => {
		const staleNow = STALE_THRESHOLD_MS + 1_000;
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "claude",
					status: "running",
					attentionState: "idle",
					lastActivityAt: 0,
					lastOutputPreview: null,
					exitCode: null,
					agentAttentionReasons: {},
					agentAttentionClearedAt: 100,
				},
			],
			staleNow,
		);
		expect(summary.rows[0].context).not.toContain("stale");
	});

	it("renders waiting reason text from terminal source", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "claude",
					status: "running",
					attentionState: "actionRequired",
					lastActivityAt: now,
					lastOutputPreview: null,
					exitCode: null,
					agentAttentionReasons: {
						terminal: {
							state: "waiting",
							source: "terminal",
							summary: "y/n prompt",
							nextAction: null,
							reportedAt: now,
						},
					},
					agentAttentionClearedAt: null,
				},
			],
			now,
		);
		expect(summary.rows[0].context).toBe("waiting: y/n prompt");
	});

	it("surfaces lifecycle failed reason after process exit (status: error)", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "tests",
					status: "error",
					attentionState: "idle",
					lastActivityAt: now,
					lastOutputPreview: null,
					exitCode: 1,
					agentAttentionReasons: {
						lifecycle: {
							state: "failed",
							source: "lifecycle",
							summary: "tests failed",
							nextAction: null,
							reportedAt: now,
						},
					},
					agentAttentionClearedAt: null,
				},
			],
			now,
		);
		expect(summary.rows[0].context).toBe("failed: tests failed");
	});

	it("does not derive stale for non-running processes", () => {
		const staleNow = STALE_THRESHOLD_MS + 5_000;
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "lint",
					status: "exited",
					attentionState: "idle",
					lastActivityAt: 0,
					lastOutputPreview: null,
					exitCode: 0,
					agentAttentionReasons: {},
					agentAttentionClearedAt: null,
				},
			],
			staleNow,
		);
		expect(summary.rows[0].context).not.toContain("stale");
	});

	it("sets hasFailedReason true when lifecycle:failed present", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "tests",
					status: "error",
					attentionState: "idle",
					lastActivityAt: now,
					lastOutputPreview: null,
					exitCode: 1,
					agentAttentionReasons: {
						lifecycle: {
							state: "failed",
							source: "lifecycle",
							summary: "tests failed",
							nextAction: null,
							reportedAt: now,
						},
					},
					agentAttentionClearedAt: null,
				},
			],
			now,
		);
		expect(summary.rows[0].hasFailedReason).toBe(true);
	});

	it("sets hasFailedReason false when no failed reason", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "dev",
					status: "running",
					attentionState: "activity",
					lastActivityAt: now,
					lastOutputPreview: "compiled",
					exitCode: null,
					agentAttentionReasons: {
						terminal: {
							state: "waiting",
							source: "terminal",
							summary: "y/n prompt",
							nextAction: null,
							reportedAt: now,
						},
					},
					agentAttentionClearedAt: null,
				},
			],
			now,
		);
		expect(summary.rows[0].hasFailedReason).toBe(false);
	});
});

describe("buildWorktreeProcessSummary — provider", () => {
	it("includes provider in each SidebarShellRow", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "p1",
					label: "claude",
					status: "running",
					attentionState: "idle",
					lastActivityAt: now,
					lastOutputPreview: null,
					exitCode: null,
					provider: "claude",
				},
				{
					id: "p2",
					label: "codex",
					status: "running",
					attentionState: "idle",
					lastActivityAt: now,
					lastOutputPreview: null,
					exitCode: null,
					provider: "codex",
				},
				{
					id: "p3",
					label: "dev",
					status: "running",
					attentionState: "idle",
					lastActivityAt: now,
					lastOutputPreview: null,
					exitCode: null,
					provider: null,
				},
			],
			Date.now(),
			3,
		);
		const providers = summary.rows.map((r) => r.provider);
		expect(providers).toEqual(
			expect.arrayContaining(["claude", "codex", null]),
		);
	});
});

describe("buildWorktreeAttentionDisplay", () => {
	it("overlays session-level mcp reason on process states", () => {
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: {
				mcp: {
					state: "ready",
					source: "mcp",
					summary: "implementation complete",
					nextAction: null,
					reportedAt: now,
				},
			},
			processSummary: { rows: [], overflowCount: 0 },
			now,
		});
		expect(display.state).toBe("ready");
		expect(display.context).toContain("implementation complete");
	});

	it("returns the strongest of mcp vs process rows", () => {
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: {
				mcp: {
					state: "ready",
					source: "mcp",
					summary: "implementation complete",
					nextAction: null,
					reportedAt: now,
				},
			},
			processSummary: {
				rows: [
					{
						id: "p1",
						label: "claude",
						state: "actionRequired",
						context: "waiting: y/n prompt",
						lastActivityAt: now,
						hasFailedReason: false,
						provider: null,
					},
				],
				overflowCount: 0,
				topRow: {
					id: "p1",
					label: "claude",
					state: "actionRequired",
					context: "waiting: y/n prompt",
					lastActivityAt: now,
					hasFailedReason: false,
					provider: null,
				},
			},
			now,
		});
		expect(display.state).toBe("actionRequired");
	});

	it("maps mcp ready to SidebarShellState 'ready', not 'activity'", () => {
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: {
				mcp: {
					state: "ready",
					source: "mcp",
					summary: "done",
					nextAction: null,
					reportedAt: now,
				},
			},
			processSummary: { rows: [], overflowCount: 0, topRow: null },
			now,
		});
		expect(display.state).toBe("ready");
		expect(display.state).not.toBe("activity");
	});

	it("returns process row when session and process have equal severity rank", () => {
		// both mcp:waiting (session actionRequired rank 4) and top process row are at
		// actionRequired (rank 4) — per the strict > comparison, process row wins on tie
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: {
				mcp: {
					state: "waiting",
					source: "mcp",
					summary: "mcp waiting",
					nextAction: null,
					reportedAt: 1_000,
				},
			},
			processSummary: {
				rows: [
					{
						id: "p1",
						label: "claude",
						state: "actionRequired",
						context: "process context",
						lastActivityAt: now,
						hasFailedReason: false,
						provider: null,
					},
				],
				overflowCount: 0,
				topRow: {
					id: "p1",
					label: "claude",
					state: "actionRequired",
					context: "process context",
					lastActivityAt: now,
					hasFailedReason: false,
					provider: null,
				},
			},
			now: 5_000, // 4 s after reportedAt=1000, fresh (< STALE_THRESHOLD_MS=120 000)
		});
		expect(display.state).toBe("actionRequired");
		expect(display.context).toBe("process context");
	});
});

// ---------------------------------------------------------------------------
// Three-tier tests (Task 1)
// ---------------------------------------------------------------------------

const reason = (
	state: AgentAttentionReason["state"],
	source: AgentAttentionReason["source"],
	reportedAt: number,
	summary = "x",
): AgentAttentionReason => ({ state, source, summary, nextAction: null, reportedAt });

const emptySummary = { rows: [], overflowCount: 0, topRow: null };
// All reportedAt/now values below are relative to STALE_THRESHOLD_MS = 120_000ms.

import { rollupWorkspaceAttention } from "../../../src/features/workspace/logic/sidebar-shell-summary";

describe("rollupWorkspaceAttention", () => {
	it("returns actionRequired if any worktree needs action", () => {
		expect(rollupWorkspaceAttention(["idle", "ready", "actionRequired"])).toBe("actionRequired");
	});
	it("returns ready if any worktree is ready and none need action", () => {
		expect(rollupWorkspaceAttention(["idle", "activity", "ready"])).toBe("ready");
	});
	it("returns null when everything is calm", () => {
		expect(rollupWorkspaceAttention(["idle", "activity", "idle"])).toBeNull();
		expect(rollupWorkspaceAttention([])).toBeNull();
	});
});

describe("buildWorktreeAttentionDisplay three-tier", () => {
	it("retires a stale mcp:waiting cleared by a later workflow:done (the false-red bug)", () => {
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: {
				mcp: reason("waiting", "mcp", 1000),
				workflow: reason("ready", "workflow", 2000, "workflow done"),
			},
			processSummary: emptySummary,
			now: 2000,
			agentAttentionClearedAt: 2000,
		});
		expect(display.state).toBe("ready");
	});

	it("surfaces a done workflow as the ready tier", () => {
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: { workflow: reason("ready", "workflow", 5) },
			processSummary: emptySummary,
			now: 5,
			agentAttentionClearedAt: null,
		});
		expect(display.state).toBe("ready");
	});

	it("keeps a fresh mcp:waiting (reported after the clear) red", () => {
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: { mcp: reason("waiting", "mcp", 3000) },
			processSummary: emptySummary,
			now: 3500,
			agentAttentionClearedAt: 2000,
		});
		expect(display.state).toBe("actionRequired");
	});

	it("retires a lone stale-by-age mcp:waiting with no terminal clear (spec §4.2)", () => {
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: { mcp: reason("waiting", "mcp", 1000) },
			processSummary: emptySummary,
			now: 1000 + 200_000, // quiet > STALE_THRESHOLD_MS since the waiting was reported
			agentAttentionClearedAt: null,
		});
		expect(display.state).toBe("idle");
	});

	it("keeps a recent mcp:waiting red even without a clear", () => {
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: { mcp: reason("waiting", "mcp", 1000) },
			processSummary: emptySummary,
			now: 1000 + 5_000, // 5s < STALE_THRESHOLD_MS
			agentAttentionClearedAt: null,
		});
		expect(display.state).toBe("actionRequired");
	});

	it("ignores non-authoritative session sources at session scope", () => {
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: { terminal: reason("waiting", "terminal", 9) },
			processSummary: emptySummary,
			now: 9,
		});
		expect(display.state).toBe("idle");
	});
});

// ---------------------------------------------------------------------------
// Process-path action-required retirement (Task 13, spec §4.2 gap 3)
// ---------------------------------------------------------------------------

const proc = (over: Record<string, unknown> = {}) => ({
	id: "p",
	label: "claude",
	status: "running" as const,
	attentionState: "actionRequired" as const,
	lastActivityAt: 0,
	lastOutputPreview: null,
	exitCode: null,
	agentAttentionReasons: {},
	agentAttentionClearedAt: null,
	...over,
});

describe("deriveState process-path retirement", () => {
	it("retires a running process's actionRequired once it is quiet past the threshold", () => {
		const summary = buildWorktreeProcessSummary([proc({ lastActivityAt: 0 })], 200_000);
		expect(summary.topRow?.state).not.toBe("actionRequired");
	});
	it("keeps a fresh running process's actionRequired", () => {
		const summary = buildWorktreeProcessSummary([proc({ lastActivityAt: 4_000 })], 5_000);
		expect(summary.topRow?.state).toBe("actionRequired");
	});
	it("retires a fresh-but-cleared running process (clearedAt >= lastActivityAt)", () => {
		// Recent activity (not stale by age) but cleared after that activity → retired.
		const summary = buildWorktreeProcessSummary(
			[proc({ lastActivityAt: 4_000, agentAttentionClearedAt: 4_000 })],
			5_000,
		);
		expect(summary.topRow?.state).not.toBe("actionRequired");
	});
	it("an exited process is never actionRequired", () => {
		const summary = buildWorktreeProcessSummary(
			[proc({ status: "exited", lastActivityAt: 100 })],
			1_000,
		);
		expect(summary.topRow?.state).toBe("exited");
	});
});
