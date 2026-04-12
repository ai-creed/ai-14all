import { describe, expect, it } from "vitest";
import {
	buildWorktreeProcessSummary,
	formatQuietAge,
} from "../../../src/features/workspace/sidebar-shell-summary";

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

		expect(summary.rows.map((row) => [row.label, row.state, row.context])).toEqual([
			["claude", "actionRequired", "Continue? [y/N]"],
			["lint", "exited", "exit 1"],
			["dev", "active", "compiled in 124ms"],
			["tests", "idle", "quiet for 12s"],
		]);
	});

	it("sorts by severity first and recency second", () => {
		const summary = buildWorktreeProcessSummary(
			[
				{
					id: "older-active",
					label: "older active",
					status: "running",
					attentionState: "activity",
					lastActivityAt: 12_000,
					lastOutputPreview: "working",
					exitCode: null,
				},
				{
					id: "newer-idle",
					label: "newer idle",
					status: "running",
					attentionState: "idle",
					lastActivityAt: 8_000,
					lastOutputPreview: "stale",
					exitCode: null,
				},
			],
			now,
			4,
		);

		expect(summary.rows.map((row) => row.label)).toEqual([
			"older active",
			"newer idle",
		]);
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
});
