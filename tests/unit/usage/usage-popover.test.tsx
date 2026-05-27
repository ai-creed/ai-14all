// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	UsagePopover,
	selectRows,
} from "../../../src/features/telemetry/UsagePopover.js";
import type { UsageSnapshot } from "../../../shared/models/usage.js";

const NOW = 1_000_000_000_000;
const snapshot: UsageSnapshot = {
	generatedAtMs: NOW,
	limits: [
		{
			provider: "codex",
			real: true,
			fiveHour: { percent: 3, resetsAtMs: NOW + 90 * 60_000 },
			weekly: {
				percent: 41,
				resetsAtMs: NOW + 3 * 86_400_000,
				used: null,
				budget: null,
			},
		},
		{
			provider: "claude",
			real: false,
			fiveHour: { percent: 12, resetsAtMs: null },
			weekly: {
				percent: 28,
				resetsAtMs: null,
				used: 2_500_000,
				budget: 9_000_000,
			},
		},
	],
	rows: [
		{
			workspaceId: "ws1",
			worktreeId: "w1",
			worktreePath: "/p/w1",
			worktreeTitle: "main",
			provider: "codex",
			active: true,
			sinceLaunch: {
				input: 700_000,
				output: 100_000,
				billable: 800_000,
				raw: 12_900_000,
			},
			thisWeek: { input: 0, output: 0, billable: 5_100_000, raw: 0 },
		},
		{
			workspaceId: "ws1",
			worktreeId: "w2",
			worktreePath: "/p/w2",
			worktreeTitle: "old-branch",
			provider: "claude",
			active: false,
			sinceLaunch: {
				input: 1_000_000,
				output: 200_000,
				billable: 1_200_000,
				raw: 9_000_000,
			},
			thisWeek: { input: 0, output: 0, billable: 0, raw: 0 },
		},
		{
			workspaceId: null,
			worktreeId: null,
			worktreePath: null,
			worktreeTitle: "other (untracked)",
			provider: "claude",
			active: false,
			sinceLaunch: {
				input: 3_000_000,
				output: 500_000,
				billable: 3_500_000,
				raw: 28_000_000,
			},
			thisWeek: { input: 0, output: 0, billable: 0, raw: 0 },
		},
	],
	totals: { input: 0, output: 0, billable: 0, raw: 0 },
	config: {
		fiveHourBudget: 5_000_000,
		weeklyBudget: 112_000_000,
		weeklyResetDay: 1,
		weeklyResetHour: 7,
	},
};

describe("selectRows", () => {
	it("active scope keeps only active tracked rows", () => {
		expect(
			selectRows(snapshot.rows, "active", false).map((r) => r.worktreeId),
		).toEqual(["w1"]);
	});
	it("all scope keeps all tracked; untracked adds the null row", () => {
		expect(
			selectRows(snapshot.rows, "all", false).map((r) => r.worktreeId),
		).toEqual(["w1", "w2"]);
		expect(
			selectRows(snapshot.rows, "all", true).some(
				(r) => r.workspaceId === null,
			),
		).toBe(true);
	});
});

describe("UsagePopover", () => {
	it("scope + untracked toggles change rows and total", () => {
		render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		const total = () => screen.getByTestId("usage-total").textContent ?? "";
		expect(screen.queryByText(/old-branch/)).toBeNull();
		expect(total()).toContain("0.7M");
		fireEvent.click(screen.getByRole("button", { name: "all tracked" }));
		expect(screen.getByText(/old-branch/)).toBeTruthy();
		expect(total()).toContain("1.7M");
		fireEvent.click(screen.getByLabelText("include untracked"));
		expect(total()).toContain("4.7M");
	});
	it("renders codex reset countdown and claude used/budget", () => {
		render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		expect(screen.getByText(/resets 1h30m/)).toBeTruthy();
		expect(screen.getByText(/2\.5M \/ 9\.0M/)).toBeTruthy();
	});
});
