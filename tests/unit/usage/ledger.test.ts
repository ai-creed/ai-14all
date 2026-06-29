import { describe, expect, it } from "vitest";
import {
	applyContribution,
	bucketKey,
	bucketsForScope,
	createLedger,
	createSession,
	hourlySeries,
	ingestEvent,
	parseBucketKey,
	recordContribution,
	startOfHour,
	startOfLocalDay,
	type ContributionJson,
} from "../../../services/usage/ledger.js";
import type { UsageEvent } from "../../../shared/models/usage.js";

const HOUR = 3_600_000;
const ev = (over: Partial<UsageEvent>): UsageEvent => ({
	provider: "codex",
	timestampMs: 0,
	cwd: "/a",
	sessionId: "s",
	model: "m",
	input: 0,
	output: 0,
	billable: 0,
	raw: 0,
	...over,
});

describe("ledger scope queries", () => {
	it("session/week/month/all-time select distinct windows", () => {
		const ledger = createLedger();
		const session = createSession();
		// now = noon on a fixed local day
		const now = new Date(2026, 5, 17, 12, 0, 0, 0).getTime(); // Wed 2026-06-17
		const lastMonth = new Date(2026, 4, 10, 9, 0, 0, 0).getTime(); // 2026-05-10
		const recentBeforeMonday = new Date(2026, 5, 12, 9, 0, 0, 0).getTime(); // Fri 2026-06-12: within the trailing 7 days but BEFORE this calendar Monday (06-15)
		const thisWeek = new Date(2026, 5, 16, 9, 0, 0, 0).getTime(); // Tue 2026-06-16
		// ingest with launch AFTER now so session stays empty for the historical events
		ingestEvent(ledger, session, ev({ timestampMs: lastMonth, billable: 100, raw: 100 }), now + HOUR);
		ingestEvent(ledger, session, ev({ timestampMs: recentBeforeMonday, billable: 10, raw: 10 }), now + HOUR);
		ingestEvent(ledger, session, ev({ timestampMs: thisWeek, billable: 1, raw: 1 }), now + HOUR);

		const sum = (m: Map<string, { billable: number }>) =>
			[...m.values()].reduce((a, t) => a + t.billable, 0);

		expect(sum(bucketsForScope(ledger, session, "all-time", now))).toBe(111);
		expect(sum(bucketsForScope(ledger, session, "month", now))).toBe(11); // June only: 06-12 + 06-16 (05-10 excluded)
		expect(sum(bucketsForScope(ledger, session, "week", now))).toBe(11); // rolling 7 days (06-11..06-17): 06-12 + 06-16; a calendar-Monday week would drop 06-12 → 1
		expect(sum(bucketsForScope(ledger, session, "session", now))).toBe(0); // launch after all events
	});

	it("session scope reads the session accumulator, not the ledger", () => {
		const ledger = createLedger();
		const session = createSession();
		const now = Date.now();
		ingestEvent(ledger, session, ev({ timestampMs: now, billable: 9, raw: 9 }), now - HOUR); // post-launch
		const s = bucketsForScope(ledger, session, "session", now);
		expect([...s.values()].reduce((a, t) => a + t.billable, 0)).toBe(9);
	});

	it("hourlySeries is sorted ascending and per-provider", () => {
		const session = createSession();
		const ledger = createLedger();
		const base = startOfHour(Date.now());
		ingestEvent(ledger, session, ev({ provider: "claude", timestampMs: base + 2 * HOUR, billable: 3, raw: 3 }), 0);
		ingestEvent(ledger, session, ev({ provider: "codex", timestampMs: base, billable: 5, raw: 5 }), 0);
		const series = hourlySeries(session);
		expect(series.map((p) => p.hourStartMs)).toEqual([base, base + 2 * HOUR]);
		expect(series[0].tokens).toEqual({ codex: 5 });
		expect(series[1].tokens).toEqual({ claude: 3 });
	});
});

describe("ledger ingest", () => {
	it("round-trips a BucketKey via the \\u0000 escape (no raw control byte)", () => {
		const k = bucketKey("/a", "claude", "claude-opus-4-8");
		expect(k).toBe("/a\u0000claude\u0000claude-opus-4-8");
		expect(JSON.stringify({ k })).not.toContain("\\u0000".replace("\\u0000", "\x00"));
		expect(parseBucketKey(k)).toEqual({ cwd: "/a", provider: "claude", model: "claude-opus-4-8" });
	});

	it("buckets the ledger by (local-day, cwd, provider, model)", () => {
		const ledger = createLedger();
		const session = createSession();
		const t = startOfLocalDay(1_000 * HOUR) + 5 * HOUR; // some time on that day
		ingestEvent(ledger, session, ev({ timestampMs: t, billable: 7, raw: 70, input: 5, output: 2 }), 0);
		const day = ledger.days.get(startOfLocalDay(t));
		expect(day?.get(bucketKey("/a", "codex", "m"))).toEqual({ input: 5, output: 2, billable: 7, raw: 70 });
	});

	it("writes the session + hourly only for ts >= launchMs; ledger always", () => {
		const ledger = createLedger();
		const session = createSession();
		const launch = 1_000 * HOUR;
		ingestEvent(ledger, session, ev({ timestampMs: launch - HOUR, billable: 5, raw: 50 }), launch); // pre-launch
		ingestEvent(ledger, session, ev({ timestampMs: launch + HOUR, billable: 7, raw: 70 }), launch);
		// session sees ONLY the post-launch event
		expect(session.since.get(bucketKey("/a", "codex", "m"))).toEqual({ input: 0, output: 0, billable: 7, raw: 70 });
		expect(session.hourly.get(startOfHour(launch + HOUR))).toEqual({ codex: 7 });
		// ledger sees BOTH (sum across the two days/buckets is 12 billable)
		let billable = 0;
		for (const buckets of ledger.days.values())
			for (const tt of buckets.values()) billable += tt.billable;
		expect(billable).toBe(12);
	});
});

describe("contribution reconcile", () => {
	it("subtracting a file's contribution removes exactly what it added", () => {
		const ledger = createLedger();
		const session = createSession();
		const day = startOfLocalDay(Date.now());
		const key = bucketKey("/a", "codex", "m");
		// simulate ingest of one file's two events into the ledger + its contribution
		const contrib: ContributionJson = {};
		const e1 = ev({ timestampMs: day + HOUR, billable: 7, raw: 70, input: 5, output: 2 });
		const e2 = ev({ timestampMs: day + 2 * HOUR, billable: 3, raw: 30, input: 1, output: 2 });
		for (const e of [e1, e2]) {
			ingestEvent(ledger, session, e, Number.MAX_SAFE_INTEGER); // ledger only
			recordContribution(contrib, startOfLocalDay(e.timestampMs), key, e);
		}
		expect(ledger.days.get(day)?.get(key)?.billable).toBe(10);
		applyContribution(ledger, contrib, -1);
		expect(ledger.days.get(day)?.get(key)).toEqual({ input: 0, output: 0, billable: 0, raw: 0 });
	});
});
