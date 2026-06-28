import { providerDef } from "../../shared/models/agent-provider.js";
import type { AgentProviderId } from "../../shared/models/agent-provider.js";
import type {
	KnownWorktree,
	ProviderRateLimits,
	ProviderTelemetryInfo,
	ScopeData,
	ScopeRollupRow,
	TokenTotals,
	UsageProvider,
	UsageRow,
	UsageScope,
	UsageSnapshot,
} from "../../shared/models/usage.js";
import { buildCostSnapshot, estimateCostUsd, type RateLookup } from "./cost/cost.js";
import { rateFor } from "./cost/pricing.js";
import {
	type BucketKey,
	type DailyLedger,
	type SessionState,
	bucketsForScope,
	dailySeries,
	emptyTotals,
	hourlySeries,
	parseBucketKey,
} from "./ledger.js";
import { TELEMETRY_DRIVERS } from "./providers/index.js";
import type { TelemetryDriver } from "./providers/types.js";
import { matchCwd, workspaceGroupFor } from "./worktree-map.js";

export interface BuildSnapshotInput {
	ledger: DailyLedger;
	session: SessionState;
	known: KnownWorktree[];
	activeWorktreeIds: string[];
	nowMs: number;
	includeUntracked: boolean;
	chipRange: "week" | "month";
	providersWithData: Set<AgentProviderId>;
	codexLimits: ProviderRateLimits | null;
	drivers?: readonly TelemetryDriver[];
	rate?: RateLookup;
}

const SCOPES: UsageScope[] = ["session", "week", "month", "all-time"];

function addInto(a: TokenTotals, b: TokenTotals): void {
	a.input += b.input;
	a.output += b.output;
	a.billable += b.billable;
	a.raw += b.raw;
}

// Build one coherent scope from its merged buckets. Every number — totalTokens,
// byProvider, rows, cost — is derived from the SAME bucket map, so they agree by
// construction (the headline fix).
export function buildScopeData(
	scope: UsageScope,
	buckets: Map<BucketKey, TokenTotals>,
	known: KnownWorktree[],
	activeWorktreeIds: string[],
	includeUntracked: boolean,
	rate: RateLookup,
): ScopeData {
	// Aggregate by provider and by (worktree|untracked, provider).
	const byProviderTotals = new Map<AgentProviderId, TokenTotals>();
	// rowKey -> { meta, tokens }
	const rowAgg = new Map<string, { row: Omit<UsageRow, "tokens" | "costUsd">; tokens: TokenTotals }>();
	let totalTokens = 0;

	for (const [key, t] of buckets) {
		const { cwd, provider } = parseBucketKey(key);
		totalTokens += t.billable;

		const pv = byProviderTotals.get(provider) ?? emptyTotals();
		addInto(pv, t);
		byProviderTotals.set(provider, pv);

		const wt = matchCwd(cwd, known);
		let rk: string;
		let meta: Omit<UsageRow, "tokens" | "costUsd">;
		if (wt) {
			rk = `${wt.worktreeId}\u0000${provider}`;
			meta = {
				workspaceId: wt.workspaceId,
				worktreeId: wt.worktreeId,
				worktreePath: wt.path,
				worktreeTitle: wt.title,
				provider: provider as UsageProvider,
				active: activeWorktreeIds.includes(wt.worktreeId),
			};
		} else {
			const g = workspaceGroupFor(cwd, known);
			rk = `${g.workspaceId ?? "__untracked__"}\u0000${provider}`;
			meta = {
				workspaceId: g.workspaceId,
				worktreeId: null,
				worktreePath: null,
				worktreeTitle: g.title,
				provider: provider as UsageProvider,
				active: false,
			};
		}
		const existing = rowAgg.get(rk);
		if (existing) {
			addInto(existing.tokens, t);
		} else {
			rowAgg.set(rk, { row: meta, tokens: { ...t } });
		}
	}

	// Cost for the scope (and per-provider $) from the same window's (provider,model)
	// — model is ignored by blended pricing, so aggregate by provider.
	const cost = buildCostSnapshot(
		[...byProviderTotals.entries()].map(([provider, tokens]) => ({ provider, model: "", tokens })),
		rate,
	);

	const byProvider: ScopeRollupRow[] = [...byProviderTotals.entries()]
		.map(([provider, tokens]) => ({
			provider,
			tokens: tokens.billable,
			costUsd: cost.perProvider[provider] ?? null,
		}))
		.sort((a, b) => b.tokens - a.tokens);

	const rows: UsageRow[] = [...rowAgg.values()].map(({ row, tokens }) => ({
		...row,
		tokens,
		costUsd: estimateCostUsd(tokens, rate(row.provider)),
	}));

	// totalTokens already excludes nothing; but to honor includeUntracked the
	// renderer filters untracked rows client-side. Keep totals over ALL buckets so
	// totalTokens == sum(rows) == sum(byProvider) holds unconditionally.
	void includeUntracked;

	return { scope, totalTokens, byProvider, rows, cost };
}

export function buildSnapshot(input: BuildSnapshotInput): UsageSnapshot {
	const rate = input.rate ?? rateFor;
	const drivers = input.drivers ?? TELEMETRY_DRIVERS;

	const scopes = {} as Record<UsageScope, ScopeData>;
	for (const scope of SCOPES) {
		const buckets = bucketsForScope(input.ledger, input.session, scope, input.nowMs);
		scopes[scope] = buildScopeData(
			scope,
			buckets,
			input.known,
			input.activeWorktreeIds,
			input.includeUntracked,
			rate,
		);
	}

	const providers: ProviderTelemetryInfo[] = drivers.map((d) => {
		const def = providerDef(d.id);
		return {
			id: d.id,
			label: def.label,
			brand: def.brand,
			capabilities: d.capabilities,
			hasData: input.providersWithData.has(d.id),
		};
	});

	const codexDriver = drivers.find((d) => d.id === "codex");
	const codexLimits =
		codexDriver?.buildGauge && input.codexLimits
			? codexDriver.buildGauge({ providerLimits: input.codexLimits, nowMs: input.nowMs })
			: null;

	return {
		generatedAtMs: input.nowMs,
		providers,
		scopes,
		seriesDaily: dailySeries(input.ledger, input.nowMs),
		seriesHourly: hourlySeries(input.session),
		codexLimits,
		config: { chipRange: input.chipRange, includeUntracked: input.includeUntracked },
	};
}
