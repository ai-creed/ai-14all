import { describe, expect, it } from "vitest";
import { groupByWorkspace } from "../../../src/features/telemetry/group.js";
import type { UsageRow } from "../../../shared/models/usage.js";

const rows: UsageRow[] = [
	{
		workspaceId: "ws1",
		worktreeId: "w1",
		worktreePath: "/Users/me/Dev/app",
		worktreeTitle: "main",
		provider: "claude",
		active: true,
		sinceLaunch: { input: 1, output: 1, billable: 2, raw: 20 },
		thisWeek: { input: 0, output: 0, billable: 9, raw: 0 },
	},
	{
		workspaceId: "ws1",
		worktreeId: "w1",
		worktreePath: "/Users/me/Dev/app",
		worktreeTitle: "main",
		provider: "codex",
		active: true,
		sinceLaunch: { input: 1, output: 0, billable: 1, raw: 10 },
		thisWeek: { input: 0, output: 0, billable: 5, raw: 0 },
	},
	{
		workspaceId: null,
		worktreeId: null,
		worktreePath: null,
		worktreeTitle: "other (untracked)",
		provider: "claude",
		active: false,
		sinceLaunch: { input: 3, output: 0, billable: 3, raw: 30 },
		thisWeek: { input: 0, output: 0, billable: 4, raw: 0 },
	},
];

describe("groupByWorkspace", () => {
	it("groups rows under workspace with subtotal; untracked last", () => {
		const groups = groupByWorkspace(rows);
		expect(groups[0].workspaceId).toBe("ws1");
		expect(groups[0].subtotal).toEqual({
			input: 2,
			output: 1,
			billable: 3,
			raw: 30,
		});
		expect(groups[groups.length - 1].workspaceId).toBeNull();
	});
});
