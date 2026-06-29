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
		tokens: { input: 1, output: 1, billable: 2, raw: 20 },
		costUsd: 0.02,
	},
	{
		workspaceId: "ws1",
		worktreeId: "w1",
		worktreePath: "/Users/me/Dev/app",
		worktreeTitle: "main",
		provider: "codex",
		active: true,
		tokens: { input: 1, output: 0, billable: 1, raw: 10 },
		costUsd: 0.01,
	},
	{
		workspaceId: null,
		worktreeId: null,
		worktreePath: null,
		worktreeTitle: "other (untracked)",
		provider: "claude",
		active: false,
		tokens: { input: 3, output: 0, billable: 3, raw: 30 },
		costUsd: 0.03,
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
