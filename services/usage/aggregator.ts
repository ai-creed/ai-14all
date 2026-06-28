import type { AgentProviderId } from "../../shared/models/agent-provider.js";
import { AGENT_PROVIDER_IDS } from "../../shared/models/agent-provider.js";
import type {
	DailyPoint,
	ProviderRateLimits,
	TokenTotals,
	UsageEvent,
	UsageProvider,
} from "../../shared/models/usage.js";
import { RollingCounter } from "./rolling-counter.js";

const WEEK_MS = 7 * 24 * 3_600_000;
const FIVE_H_MS = 5 * 3_600_000;
const SEP = " ";
const key = (provider: UsageProvider, cwd: string): string =>
	`${provider}${SEP}${cwd}`;

export interface CostEntry {
	provider: AgentProviderId;
	model: string;
	tokens: TokenTotals;
}

const DAY_MS = 86_400_000;
// The daily chart spans week AND month views, so the analytics series must cover
// ~35 days. The worker re-reads files modified within this window on launch (the
// aggregator is rebuilt empty each run) so the FULL month repopulates after a
// restart — not just the rolling week. See Task 13's resetRecentOffsets call.
export const SERIES_WINDOW_DAYS = 35;
export const SERIES_WINDOW_MS = SERIES_WINDOW_DAYS * DAY_MS;
const LEDGER_SEP = "\u0000"; // NUL separator avoids (provider, model) key collisions
function startOfLocalDay(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export class UsageAggregator {
	private readonly launchMs: number;
	private readonly since = new Map<string, TokenTotals>();
	private readonly week = new Map<string, RollingCounter>();
	private readonly rolling = new Map<string, RollingCounter>(); // `${provider}|${windowMs}`
	private readonly providerLimits = new Map<AgentProviderId, ProviderRateLimits>();
	private readonly daily = new Map<number, Partial<Record<AgentProviderId, number>>>();
	private readonly ledger = new Map<string, TokenTotals>(); // `${provider}\u0000${model}`
	private readonly seen = new Set<AgentProviderId>();

	constructor(launchMs: number) {
		this.launchMs = launchMs;
	}

	private rcFor(provider: UsageProvider, windowMs: number): RollingCounter {
		const rk = `${provider}|${windowMs}`;
		let rc = this.rolling.get(rk);
		if (!rc) {
			rc = new RollingCounter({
				windowMs,
				bucketMs: windowMs <= FIVE_H_MS ? 60_000 : 300_000,
			});
			this.rolling.set(rk, rc);
		}
		return rc;
	}

	ingest(e: UsageEvent): void {
		const k = key(e.provider, e.cwd);
		if (e.timestampMs >= this.launchMs) {
			const cur = this.since.get(k) ?? {
				input: 0,
				output: 0,
				billable: 0,
				raw: 0,
			};
			cur.input += e.input;
			cur.output += e.output;
			cur.billable += e.billable;
			cur.raw += e.raw;
			this.since.set(k, cur);
		}
		let wc = this.week.get(k);
		if (!wc) {
			wc = new RollingCounter({ windowMs: WEEK_MS, bucketMs: 3_600_000 });
			this.week.set(k, wc);
		}
		wc.add(e.timestampMs, e.billable);
		this.rcFor(e.provider, FIVE_H_MS).add(e.timestampMs, e.billable);
		this.rcFor(e.provider, WEEK_MS).add(e.timestampMs, e.billable);

		this.seen.add(e.provider);
		// daily series (local-day aligned)
		const dayStart = startOfLocalDay(e.timestampMs);
		const dayRec = this.daily.get(dayStart) ?? {};
		dayRec[e.provider] = (dayRec[e.provider] ?? 0) + e.billable;
		this.daily.set(dayStart, dayRec);
		// per-(provider, model) cost ledger
		const lk = `${e.provider}${LEDGER_SEP}${e.model}`;
		const lt = this.ledger.get(lk) ?? { input: 0, output: 0, billable: 0, raw: 0 };
		lt.input += e.input;
		lt.output += e.output;
		lt.billable += e.billable;
		lt.raw += e.raw;
		this.ledger.set(lk, lt);
	}

	setProviderLimits(id: AgentProviderId, limits: ProviderRateLimits): void {
		const cur = this.providerLimits.get(id);
		if (!cur || limits.capturedAtMs >= cur.capturedAtMs) {
			this.providerLimits.set(id, limits);
		}
	}

	getProviderLimits(id: AgentProviderId): ProviderRateLimits | null {
		return this.providerLimits.get(id) ?? null;
	}

	/** @deprecated use setProviderLimits("codex", …) — removed in cleanup task. */
	setCodexLimits(limits: ProviderRateLimits): void {
		this.setProviderLimits("codex", limits);
	}

	/** @deprecated use getProviderLimits("codex") — removed in cleanup task. */
	latestCodexLimits(): ProviderRateLimits | null {
		return this.getProviderLimits("codex");
	}

	sinceLaunch(): Map<string, TokenTotals> {
		return this.since;
	}

	// Every provider+cwd key ingested (covers the rolling-week window). Used to
	// build per-worktree rows even when there was no activity since app launch.
	weekKeys(): string[] {
		return [...this.week.keys()];
	}

	weeklyBillable(provider: UsageProvider, cwd: string, nowMs: number): number {
		return this.week.get(key(provider, cwd))?.sum(nowMs) ?? 0;
	}

	// Billable since a fixed anchor (the weekly reset). Used instead of the rolling
	// week so the gauge matches Claude's fixed weekly reset.
	weeklyBillableSince(
		provider: UsageProvider,
		cwd: string,
		fromMs: number,
	): number {
		return this.week.get(key(provider, cwd))?.sumSince(fromMs) ?? 0;
	}

	providerBillableSince(provider: UsageProvider, fromMs: number): number {
		return this.rcFor(provider, WEEK_MS).sumSince(fromMs);
	}

	rollingBillable(
		provider: UsageProvider,
		windowMs: number,
		nowMs: number,
	): number {
		return this.rcFor(provider, windowMs).sum(nowMs);
	}

	providersWithData(): Set<AgentProviderId> {
		return new Set(this.seen);
	}

	costEntries(): CostEntry[] {
		const out: CostEntry[] = [];
		for (const [k, tokens] of this.ledger) {
			const i = k.indexOf(LEDGER_SEP);
			out.push({
				provider: k.slice(0, i) as AgentProviderId,
				model: k.slice(i + 1),
				tokens,
			});
		}
		return out;
	}

	// Per-day, per-provider billable totals for the last `windowDays` days,
	// sorted oldest-first. Days with zero activity are present with empty tokens.
	dailySeries(nowMs: number, windowDays = SERIES_WINDOW_DAYS): DailyPoint[] {
		// Generate each bucket key by walking CALENDAR dates (setDate + local
		// midnight), never by subtracting a fixed 24h. A DST transition makes a day
		// 23h/25h long, so a fixed step would drift off the true local midnights that
		// startOfLocalDay() produced at ingest and silently drop that day's activity.
		const out: DailyPoint[] = [];
		const cursor = new Date(nowMs);
		cursor.setHours(0, 0, 0, 0);
		cursor.setDate(cursor.getDate() - (windowDays - 1)); // oldest day first
		for (let i = 0; i < windowDays; i++) {
			const dayStartMs = startOfLocalDay(cursor.getTime()); // == the ingest key
			const tokens: Partial<Record<AgentProviderId, number>> = {};
			const rec = this.daily.get(dayStartMs);
			if (rec) {
				for (const id of AGENT_PROVIDER_IDS) {
					if (rec[id]) tokens[id] = rec[id];
				}
			}
			out.push({ dayStartMs, tokens });
			cursor.setDate(cursor.getDate() + 1); // DST-safe calendar-day advance
		}
		return out;
	}
}

export { FIVE_H_MS, WEEK_MS };
