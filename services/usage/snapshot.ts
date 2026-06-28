import { providerDef } from "../../shared/models/agent-provider.js";
import type {
	CostSnapshot,
	DailyPoint,
	KnownWorktree,
	LimitGauge,
	ProviderTelemetryInfo,
	TokenTotals,
	UsageProvider,
	UsageRow,
	UsageSnapshot,
} from "../../shared/models/usage.js";
import { UsageAggregator, FIVE_H_MS } from "./aggregator.js";
import { budgetPercent, weeklyAnchorMs } from "./budget.js";
import { buildCostSnapshot, type RateLookup } from "./cost/cost.js";
import { rateFor } from "./cost/pricing.js";
import { TELEMETRY_DRIVERS } from "./providers/index.js";
import type { TelemetryDriver } from "./providers/types.js";
import { matchCwd } from "./worktree-map.js";

export interface BuildSnapshotInput {
	agg: UsageAggregator;
	known: KnownWorktree[]; // all tracked worktrees (open + historical registry)
	activeWorktreeIds: string[]; // currently open in the app => scope "Active"
	nowMs: number;
	includeUntracked: boolean;
	range?: "week" | "month";
	drivers?: readonly TelemetryDriver[];
	rate?: RateLookup;
	// Deprecated (Claude budget proxy) — optional, defaulted; removed in cleanup.
	claudeTier?: string;
	fiveHourBudget?: number;
	weeklyBudget?: number;
	weeklyResetDay?: number; // 0=Sun..6=Sat (local)
	weeklyResetHour?: number; // 0..23 (local)
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
	const fiveHourBudget = input.fiveHourBudget ?? 5_000_000;
	const weeklyBudget = input.weeklyBudget ?? 112_000_000;
	const weeklyResetDay = input.weeklyResetDay ?? 1;
	const weeklyResetHour = input.weeklyResetHour ?? 7;
	const anchorMs = weeklyAnchorMs(
		nowMs,
		weeklyResetDay,
		weeklyResetHour,
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

	// Always emit untracked rows; the renderer filters them client-side based on
	// config.includeUntracked. Only totals still respect the setting.
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

	const limits: LimitGauge[] = [
		buildCodexGauge(input),
		buildClaudeGauge(input, anchorMs, fiveHourBudget, weeklyBudget),
	];

	// Analytics surface
	const drivers = input.drivers ?? TELEMETRY_DRIVERS;
	const withData = input.agg.providersWithData();
	const providers: ProviderTelemetryInfo[] = drivers.map((d) => {
		const def = providerDef(d.id);
		return {
			id: d.id,
			label: def.label,
			brand: def.brand,
			capabilities: d.capabilities,
			hasData: withData.has(d.id),
		};
	});
	const series: DailyPoint[] = input.agg.dailySeries(input.nowMs);
	const cost: CostSnapshot = buildCostSnapshot(
		input.agg.costEntries(),
		input.rate ?? rateFor,
	);
	const codexDriver = drivers.find((d) => d.id === "codex");
	const codexRl = input.agg.getProviderLimits("codex");
	const codexLimits =
		codexDriver?.buildGauge && codexRl
			? codexDriver.buildGauge({ providerLimits: codexRl, nowMs: input.nowMs })
			: null;

	return {
		generatedAtMs: nowMs,
		limits, // deprecated; removed in cleanup task
		rows,
		totals,
		config: {
			fiveHourBudget,
			weeklyBudget,
			weeklyResetDay,
			weeklyResetHour,
			range: input.range ?? "week",
			includeUntracked: input.includeUntracked,
		},
		providers,
		series,
		cost,
		codexLimits,
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
	fiveHourBudget: number,
	weeklyBudget: number,
): LimitGauge {
	const { agg, nowMs } = input;
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
