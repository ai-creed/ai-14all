import { describe, expect, it } from "vitest";
import {
	buildWorktreeAttentionDisplay,
	buildWorktreeProcessSummary,
	formatQuietAge,
} from "../../../src/features/workspace/logic/sidebar-shell-summary";
import { STALE_THRESHOLD_MS } from "../../../shared/models/agent-attention";

const now = 20_000;

describe("formatQuietAge", () => {
	it("formats quiet age in whole seconds", () => {
		expect(formatQuietAge(14_900)).toBe("quiet for 14s");
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
			["tests", "idle", "quiet for 12s"],
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
		});
		expect(display.state).toBe("active");
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
		});
		expect(display.state).toBe("actionRequired");
	});

	it("maps mcp ready to SidebarShellState 'active', not 'activity'", () => {
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
		});
		expect(display.state).toBe("active");
		expect(display.state).not.toBe("activity");
	});

	it("returns process row when mcp and top process row have equal severity rank", () => {
		// both mcp and top process row are at the "active" SidebarShellState level (ready maps to active)
		// per the > comparison, process row wins on tie
		const display = buildWorktreeAttentionDisplay({
			sessionAgentAttentionReasons: {
				mcp: {
					state: "ready",
					source: "mcp",
					summary: "mcp done",
					nextAction: null,
					reportedAt: 1_000,
				},
			},
			processSummary: {
				rows: [
					{
						id: "p1",
						label: "claude",
						state: "active",
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
					state: "active",
					context: "process context",
					lastActivityAt: now,
					hasFailedReason: false,
					provider: null,
				},
			},
		});
		expect(display.state).toBe("active");
		expect(display.context).toBe("process context");
	});
});
