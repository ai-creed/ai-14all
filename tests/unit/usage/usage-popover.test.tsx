// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsagePopover } from "../../../src/features/telemetry/UsagePopover.js";
import type {
	CostSnapshot,
	ScopeData,
	TokenTotals,
	UsageScope,
	UsageSnapshot,
} from "../../../shared/models/usage.js";

const NOW = 1_000_000_000_000;
const cap = {
	tokenLog: true,
	storeKind: "jsonl-tree" as const,
	timeSource: "per-event" as const,
	cwdSource: "in-line" as const,
	nativeLimits: false,
};

function tokens(billable: number): TokenTotals {
	return {
		input: Math.round(billable * 0.7),
		output: Math.round(billable * 0.3),
		billable,
		raw: billable,
	};
}

function cost(codexUsd: number, claudeUsd: number): CostSnapshot {
	return {
		perProvider: { codex: codexUsd, claude: claudeUsd },
		total: codexUsd + claudeUsd,
		currency: "USD",
		notional: true,
		unpricedTokens: 0,
	};
}

// Build a scope with codex=60% / claude=40% of `total` tokens, so each scope's
// total, byProvider, rows and cost are internally coherent and the four scopes
// have distinct totals we can assert against after switching.
function scopeData(
	scope: UsageScope,
	total: number,
	codexUsd: number,
	claudeUsd: number,
): ScopeData {
	const codexTok = Math.round(total * 0.6);
	const claudeTok = total - codexTok;
	return {
		scope,
		totalTokens: total,
		byProvider: [
			{ provider: "codex", tokens: codexTok, costUsd: codexUsd },
			{ provider: "claude", tokens: claudeTok, costUsd: claudeUsd },
		],
		rows: [
			{
				workspaceId: "ws1",
				worktreeId: "w1",
				worktreePath: "/p/w1",
				worktreeTitle: "main",
				provider: "codex",
				active: true,
				tokens: tokens(codexTok),
				costUsd: codexUsd,
			},
			{
				workspaceId: "ws1",
				worktreeId: "w1",
				worktreePath: "/p/w1",
				worktreeTitle: "main",
				provider: "claude",
				active: true,
				tokens: tokens(claudeTok),
				costUsd: claudeUsd,
			},
		],
		cost: cost(codexUsd, claudeUsd),
	};
}

const snapshot: UsageSnapshot = {
	generatedAtMs: NOW,
	providers: [
		{ id: "claude", label: "Claude", brand: "var(--provider-claude)", capabilities: cap, hasData: true },
		{ id: "codex", label: "Codex", brand: "var(--provider-codex)", capabilities: { ...cap, nativeLimits: true }, hasData: true },
	],
	scopes: {
		session: scopeData("session", 800_000, 1.4, 0.9), // total cost $2.30
		week: scopeData("week", 1_200_000, 3.0, 2.0), // total cost $5.00
		month: scopeData("month", 2_000_000, 6.0, 3.0), // total cost $9.00
		"all-time": scopeData("all-time", 3_000_000, 10.0, 5.0), // total cost $15.00
	},
	seriesDaily: [
		{ dayStartMs: NOW - 86_400_000, tokens: { claude: 500_000, codex: 300_000 } },
		{ dayStartMs: NOW, tokens: { codex: 500_000 } },
	],
	seriesHourly: [
		{ hourStartMs: NOW - 3_600_000, tokens: { codex: 200_000 } },
		{ hourStartMs: NOW, tokens: { claude: 100_000, codex: 300_000 } },
	],
	codexLimits: {
		provider: "codex",
		fiveHour: { percent: 41, resetsAtMs: NOW + 90 * 60_000 },
		weekly: { percent: 23, resetsAtMs: null, used: null, budget: null },
	},
	config: { chipRange: "week", includeUntracked: false },
};

describe("UsagePopover", () => {
	beforeEach(() => {
		(window as unknown as { ai14all: unknown }).ai14all = {
			usage: { setChipRange: vi.fn(), setIncludeUntracked: vi.fn() },
		};
	});

	it("opens on the Session scope (Session button active, total = session total)", () => {
		const { container } = render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		expect(screen.getByRole("button", { name: "Session" }).className).toContain("on");
		expect(screen.getByRole("button", { name: "Week" }).className).not.toContain("on");
		// session total = 0.8M
		expect(container.querySelector(".usage-pop-total")?.textContent).toContain("0.8M");
	});

	it("switches the rendered scope total when Week / Month / All-time are clicked", () => {
		const { container } = render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		const total = () => container.querySelector(".usage-pop-total")?.textContent ?? "";
		expect(total()).toContain("0.8M"); // session
		fireEvent.click(screen.getByRole("button", { name: "Week" }));
		expect(total()).toContain("1.2M");
		fireEvent.click(screen.getByRole("button", { name: "Month" }));
		expect(total()).toContain("2.0M");
		fireEvent.click(screen.getByRole("button", { name: "All-time" }));
		expect(total()).toContain("3.0M");
	});

	it("renders a chart for Session but none for All-time", () => {
		const { container } = render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		// Session => hourly chart present
		expect(container.querySelector(".usage-chart")).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "All-time" }));
		// All-time omits the chart entirely
		expect(container.querySelector(".usage-chart")).toBeNull();
	});

	it("shows a real notional cost (not $0) for a scope with tokens", () => {
		const { container } = render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		// session total cost = $2.30
		const totalText = container.querySelector(".usage-pop-total")?.textContent ?? "";
		expect(totalText).toMatch(/\$2\.30/);
		expect(totalText).not.toMatch(/\$0\.00/);
	});

	it("renders the provider roll-up rows from byProvider", () => {
		render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		expect(screen.getByText("claude")).toBeTruthy();
		expect(screen.getByText("codex")).toBeTruthy();
		// per-provider notional cost from byProvider (codex = $1.40)
		expect(screen.getByText(/\$1\.40/)).toBeTruthy();
	});

	it("switching the breakdown to Workspace shows the worktree tree", () => {
		const { container } = render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
		// "main" appears in both the workspace header (g.label) and the worktree cell;
		// scope to .usage-wt to assert the worktree row specifically.
		const wtCell = container.querySelector(".usage-wt");
		expect(wtCell?.textContent).toContain("main");
	});

	it("codex native limits are collapsed and expand on click", () => {
		const { container } = render(<UsagePopover snapshot={snapshot} onClose={() => {}} />);
		// Collapsed: glanceable summary visible, expanded detail not yet rendered
		expect(screen.getByText("5h 41% · wk 23%")).toBeTruthy();
		expect(screen.queryByText(/resets/)).toBeNull();
		// Expand: gauge percent now inside .usage-limits
		fireEvent.click(screen.getByRole("button", { name: /Codex limits/ }));
		expect(within(container.querySelector(".usage-limits")!).getByText("41%")).toBeTruthy();
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
