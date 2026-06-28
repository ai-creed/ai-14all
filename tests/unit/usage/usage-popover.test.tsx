// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	UsagePopover,
	selectRows,
} from "../../../src/features/telemetry/UsagePopover.js";
import type { UsageSnapshot } from "../../../shared/models/usage.js";

const NOW = 1_000_000_000_000;
const cap = {
	tokenLog: true,
	storeKind: "jsonl-tree" as const,
	timeSource: "per-event" as const,
	cwdSource: "in-line" as const,
	nativeLimits: false,
};
const snapshot: UsageSnapshot = {
	generatedAtMs: NOW,
	limits: [],
	rows: [
		{
			workspaceId: "ws1",
			worktreeId: "w1",
			worktreePath: "/p/w1",
			worktreeTitle: "main",
			provider: "codex",
			active: true,
			sinceLaunch: { input: 700_000, output: 100_000, billable: 800_000, raw: 800_000 },
			thisWeek: { input: 0, output: 0, billable: 800_000, raw: 0 },
		},
	],
	totals: { input: 700_000, output: 100_000, billable: 800_000, raw: 800_000 },
	config: { range: "week", includeUntracked: false },
	providers: [
		{ id: "claude", label: "Claude", brand: "var(--provider-claude)", capabilities: cap, hasData: true },
		{ id: "codex", label: "Codex", brand: "var(--provider-codex)", capabilities: { ...cap, nativeLimits: true }, hasData: true },
	],
	series: [
		{ dayStartMs: NOW - 86_400_000, tokens: { claude: 500_000, codex: 300_000 } },
		{ dayStartMs: NOW, tokens: { codex: 500_000 } },
	],
	cost: { perProvider: { claude: 1.5, codex: 1.4 }, total: 2.9, currency: "USD", notional: true, unpricedTokens: 0 },
	codexLimits: {
		provider: "codex",
		real: true,
		fiveHour: { percent: 41, resetsAtMs: NOW + 90 * 60_000 },
		weekly: { percent: 23, resetsAtMs: null, used: null, budget: null },
	},
};

describe("selectRows", () => {
	it("active scope keeps only active tracked rows", () => {
		expect(selectRows(snapshot.rows, "active", false).map((r) => r.worktreeId)).toEqual(["w1"]);
	});
});

describe("UsagePopover", () => {
	beforeEach(() => {
		(window as unknown as { ai14all: unknown }).ai14all = {
			usage: { setRange: vi.fn(), setIncludeUntracked: vi.fn() },
		};
	});

	it("defaults to the provider roll-up with notional cost", () => {
		render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		expect(screen.getByText("claude")).toBeTruthy();
		expect(screen.getByText("codex")).toBeTruthy();
		expect(screen.getByText(/\$1\.40/)).toBeTruthy();
	});

	it("range toggle calls usage.setRange", () => {
		render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "Month" }));
		expect(window.ai14all.usage.setRange).toHaveBeenCalledWith("month");
	});

	it("switching the breakdown to Workspace shows the worktree tree", () => {
		render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
		expect(screen.getByText(/main/)).toBeTruthy();
	});

	it("codex native limits are collapsed and expand on click", () => {
		render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		expect(screen.queryByText(/resets/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Codex limits/ }));
		expect(screen.getByText(/41%/)).toBeTruthy();
	});

	it("has no budget editor", () => {
		render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		expect(screen.queryByLabelText("budget settings")).toBeNull();
	});

	it("seeds the include-untracked toggle from config (default false)", () => {
		render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
		expect((screen.getByLabelText("include untracked") as HTMLInputElement).checked).toBe(false);
	});

	it("seeds the include-untracked toggle from config (true)", () => {
		const on: UsageSnapshot = {
			...snapshot,
			config: { ...snapshot.config, includeUntracked: true },
		};
		render(<UsagePopover snapshot={on} onClose={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
		expect((screen.getByLabelText("include untracked") as HTMLInputElement).checked).toBe(true);
	});
});
