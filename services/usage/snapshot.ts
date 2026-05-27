import type {
	KnownWorktree,
	LimitGauge,
	TokenTotals,
	UsageProvider,
	UsageRow,
	UsageSnapshot,
} from "../../shared/models/usage.js";
import { UsageAggregator, FIVE_H_MS } from "./aggregator.js";
import { budgetPercent, weeklyAnchorMs } from "./budget.js";
import { matchCwd } from "./worktree-map.js";

export interface BuildSnapshotInput {
	agg: UsageAggregator;
	known: KnownWorktree[]; // all tracked worktrees (open + historical registry)
	activeWorktreeIds: string[]; // currently open in the app => scope "Active"
	nowMs: number;
	includeUntracked: boolean;
	claudeTier: string;
	fiveHourBudget: number;
	weeklyBudget: number;
	weeklyResetDay: number; // 0=Sun..6=Sat (local)
	weeklyResetHour: number; // 0..23 (local)
}

const SEP = " ";
const ZERO: TokenTotals = { input: 0, output: 0, billable: 0, raw: 0 };
const add = (a: TokenTotals, b: TokenTotals): TokenTotals => ({
	input: a.input + b.input,
	output: a.output + b.output,
	billable: a.billable + b.billable,
	raw: a.raw + b.raw,
});

export function buildSnapshot(input: BuildSnapshotInput): UsageSnapshot {
	const { agg, known, nowMs, includeUntracked } = input;
	const anchorMs = weeklyAnchorMs(
		nowMs,
		input.weeklyResetDay,
		input.weeklyResetHour,
	);
	const rows: UsageRow[] = [];
	const untracked = new Map<
		UsageProvider,
		{ since: TokenTotals; week: number }
	>();
	let totals: TokenTotals = { ...ZERO };

	// Iterate every provider+cwd seen in the rolling-week window, so worktrees with
	// recent (but not this-session) activity still appear. "this week" = billable
	// since the fixed weekly reset anchor. Skip ones with nothing in either window.
	for (const k of agg.weekKeys()) {
		const sepIndex = k.indexOf(SEP);
		const provider = k.slice(0, sepIndex) as UsageProvider;
		const cwd = k.slice(sepIndex + 1);
		const since = agg.sinceLaunch().get(k) ?? ZERO;
		const week = agg.weeklyBillableSince(provider, cwd, anchorMs);
		if (since.billable === 0 && since.raw === 0 && week === 0) continue;
		const wt = matchCwd(cwd, known);
		if (!wt) {
			const u = untracked.get(provider) ?? {
				since: { ...ZERO },
				week: 0,
			};
			u.since = add(u.since, since);
			u.week += week;
			untracked.set(provider, u);
			if (includeUntracked) totals = add(totals, since);
			continue;
		}
		totals = add(totals, since);
		rows.push({
			workspaceId: wt.workspaceId,
			worktreeId: wt.worktreeId,
			worktreePath: wt.path,
			worktreeTitle: wt.title,
			provider,
			active: input.activeWorktreeIds.includes(wt.worktreeId),
			sinceLaunch: since,
			thisWeek: { input: 0, output: 0, billable: week, raw: 0 },
		});
	}

	if (includeUntracked) {
		for (const [provider, u] of untracked) {
			rows.push({
				workspaceId: null,
				worktreeId: null,
				worktreePath: null,
				worktreeTitle: "other (untracked)",
				provider,
				active: false,
				sinceLaunch: u.since,
				thisWeek: { input: 0, output: 0, billable: u.week, raw: 0 },
			});
		}
	}

	const limits: LimitGauge[] = [
		buildCodexGauge(input),
		buildClaudeGauge(input, anchorMs),
	];
	return {
		generatedAtMs: nowMs,
		limits,
		rows,
		totals,
		config: {
			fiveHourBudget: input.fiveHourBudget,
			weeklyBudget: input.weeklyBudget,
			weeklyResetDay: input.weeklyResetDay,
			weeklyResetHour: input.weeklyResetHour,
		},
	};
}

function buildCodexGauge(input: BuildSnapshotInput): LimitGauge {
	const rl = input.agg.latestCodexLimits();
	return {
		provider: "codex",
		real: true,
		fiveHour: {
			percent: rl?.primary?.usedPercent ?? 0,
			resetsAtMs: rl?.primary?.resetsAtMs ?? null,
		},
		weekly: {
			percent: rl?.secondary?.usedPercent ?? 0,
			resetsAtMs: rl?.secondary?.resetsAtMs ?? null,
			used: null,
			budget: null,
		},
	};
}

function buildClaudeGauge(
	input: BuildSnapshotInput,
	anchorMs: number,
): LimitGauge {
	const { agg, nowMs, fiveHourBudget, weeklyBudget } = input;
	// 5h stays a rolling trailing window; weekly is fixed since the reset anchor.
	const used5h = agg.rollingBillable("claude", FIVE_H_MS, nowMs);
	const usedWeek = agg.providerBillableSince("claude", anchorMs);
	return {
		provider: "claude",
		real: false,
		fiveHour: {
			percent: budgetPercent(used5h, fiveHourBudget),
			resetsAtMs: null,
		},
		weekly: {
			percent: budgetPercent(usedWeek, weeklyBudget),
			resetsAtMs: anchorMs + 7 * 24 * 3_600_000,
			used: usedWeek,
			budget: weeklyBudget,
		},
	};
}
