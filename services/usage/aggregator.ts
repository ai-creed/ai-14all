import type {
	CodexRateLimits,
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

export class UsageAggregator {
	private readonly launchMs: number;
	private readonly since = new Map<string, TokenTotals>();
	private readonly week = new Map<string, RollingCounter>();
	private readonly rolling = new Map<string, RollingCounter>(); // `${provider}|${windowMs}`
	private codexLimits: CodexRateLimits | null = null;

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
	}

	setCodexLimits(limits: CodexRateLimits): void {
		if (
			!this.codexLimits ||
			limits.capturedAtMs >= this.codexLimits.capturedAtMs
		) {
			this.codexLimits = limits;
		}
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

	latestCodexLimits(): CodexRateLimits | null {
		return this.codexLimits;
	}
}

export { FIVE_H_MS, WEEK_MS };
