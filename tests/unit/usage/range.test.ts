import { describe, expect, it } from "vitest";
import {
	buildRangeResult,
	MAX_RANGE_DAYS,
} from "../../../services/usage/range.js";
import {
	createLedger,
	createSession,
	ingestEvent,
	startOfLocalDay,
} from "../../../services/usage/ledger.js";
import type {
	KnownWorktree,
	UsageEvent,
} from "../../../shared/models/usage.js";

const DAY = 86_400_000;
const T0 = startOfLocalDay(1_750_000_000_000); // any fixed local midnight
const KNOWN: KnownWorktree[] = [
	{
		worktreeId: "wt1",
		workspaceId: "ws1",
		title: "main",
		path: "/dev/alpha/main",
	},
	{
		worktreeId: "wt2",
		workspaceId: "ws1",
		title: "feat",
		path: "/dev/alpha/feat",
	},
	{ worktreeId: "wt3", workspaceId: "ws2", title: "main", path: "/dev/beta" },
];
function ev(
	cwd: string,
	provider: string,
	dayOffset: number,
	billable: number,
): UsageEvent {
	return {
		provider: provider as UsageEvent["provider"],
		timestampMs: T0 + dayOffset * DAY + 60_000,
		cwd,
		sessionId: "s",
		model: "m",
		input: billable,
		output: 0,
		billable,
		raw: billable,
	};
}
function seeded() {
	const ledger = createLedger();
	const session = createSession();
	for (const e of [
		ev("/dev/alpha/main", "claude", 0, 100),
		ev("/dev/alpha/feat", "codex", 0, 50),
		ev("/dev/beta", "claude", 1, 70),
		ev("/tmp/elsewhere", "ezio", 1, 30), // untracked
		ev("/dev/alpha/main", "claude", 5, 999), // outside [T0, T0+3d)
	])
		ingestEvent(ledger, session, e, 0);
	return ledger;
}

describe("buildRangeResult", () => {
	it("merges only local days with dayStart in [fromMs, toMs) and sums agree", () => {
		const r = buildRangeResult(seeded(), KNOWN, [], {
			fromMs: T0,
			toMs: T0 + 3 * DAY,
		});
		const daysSum = r.days.reduce(
			(a, d) => a + Object.values(d.tokens).reduce((x, y) => x + (y ?? 0), 0),
			0,
		);
		const rowsSum = r.byWorkspace.reduce(
			(a, row) => a + row.tokens.billable,
			0,
		);
		const provSum = r.byProvider.reduce((a, p) => a + p.tokens, 0);
		expect(daysSum).toBe(250); // 100+50+70+30 — the day-5 event excluded
		expect(rowsSum).toBe(250);
		expect(provSum).toBe(250);
		expect(r.days).toHaveLength(3); // one point per local day in the window
		// (f, cost half): row costs reconcile with the RANGE cost snapshot itself —
		// with every seeded provider priced, Σ row.costUsd === cost.total exactly.
		expect(
			r.byWorkspace.reduce((a, row) => a + (row.costUsd ?? 0), 0),
		).toBeCloseTo(r.cost.total, 10);
	});

	it("NEVER filters untracked (decision 14): the untracked group row is present", () => {
		const r = buildRangeResult(seeded(), KNOWN, [], {
			fromMs: T0,
			toMs: T0 + 3 * DAY,
		});
		expect(r.byWorkspace.some((row) => row.workspaceId === null)).toBe(true);
	});

	it("earliestDayMs is the earliest ledger day with data, independent of the window", () => {
		const r = buildRangeResult(seeded(), KNOWN, [], {
			fromMs: T0 + DAY,
			toMs: T0 + 2 * DAY,
		});
		expect(r.earliestDayMs).toBe(T0);
	});

	it("empty ledger: empty rows, zero-token day points, null earliestDayMs", () => {
		const r = buildRangeResult(createLedger(), KNOWN, [], {
			fromMs: T0,
			toMs: T0 + 2 * DAY,
		});
		expect(r.byWorkspace).toEqual([]);
		expect(r.earliestDayMs).toBeNull();
		expect(r.days).toHaveLength(2);
	});

	it("day walk is self-normalized to local-day boundaries and each day point attributes tokens correctly", () => {
		// Regression guard for the DST-drift bug: the walk must re-normalize the
		// cursor to startOfLocalDay on EVERY tick, not just the first one — a raw
		// cursor.getTime() can drift off local midnight in timezones whose DST
		// transition lands at 00:00 (America/Santiago, Havana, Beirut, Asunción),
		// where setDate() cannot land back on the hour it started at. Asserting
		// self-normalization catches that drift in whatever TZ this suite runs in.
		const r = buildRangeResult(seeded(), KNOWN, [], {
			fromMs: T0,
			toMs: T0 + 3 * DAY,
		});
		for (const d of r.days) {
			expect(d.dayStartMs).toBe(startOfLocalDay(d.dayStartMs));
		}
		// Per-point attribution: day 0 seeded exactly claude=100, codex=50.
		expect(r.days[0].tokens).toEqual({ claude: 100, codex: 50 });
	});

	it("normalizes a mid-day fromMs to its local-day start for BOTH the merge window and the day walk, so sums stay in agreement", () => {
		// Regression guard: a mid-day fromMs used to feed the RAW value into the
		// merge predicate (day >= fromMs) while the walk started from
		// startOfLocalDay(fromMs) — two different windows, so `days` could include
		// a day the merge excluded (or vice versa), breaking sum agreement.
		const fromMs = T0 + 10 * 60 * 60 * 1000; // 10am on T0's local day
		const toMs = T0 + 3 * DAY;
		const r = buildRangeResult(seeded(), KNOWN, [], { fromMs, toMs });

		const daysSum = r.days.reduce(
			(a, d) => a + Object.values(d.tokens).reduce((x, y) => x + (y ?? 0), 0),
			0,
		);
		const rowsSum = r.byWorkspace.reduce(
			(a, row) => a + row.tokens.billable,
			0,
		);
		const provSum = r.byProvider.reduce((a, p) => a + p.tokens, 0);
		expect(daysSum).toBe(250);
		expect(rowsSum).toBe(250);
		expect(provSum).toBe(250);

		const fromDay = startOfLocalDay(fromMs);
		for (const d of r.days) {
			expect(d.dayStartMs).toBeGreaterThanOrEqual(fromDay);
			expect(d.dayStartMs).toBeLessThan(toMs);
		}
	});

	// AC3/§4.7 regression: `all` must be able to start at the real
	// min(earliestDayMs, anchors) with NO exception, however deep the ledger
	// goes — there is no span cap anywhere in this path anymore (the host's
	// old >10-year rejection was misplaced policy, removed). 11 years is
	// ~4,015 days, comfortably under MAX_RANGE_DAYS (10_000, ~27 years), so
	// this ledger depth must be handled with NO trimming anywhere: the ancient
	// day counts in every total AND gets its own day point in `days`.
	it("an 11-year-deep ledger: the full window sums include the ancient day, AND the day walk contains its own day point (well under the walk clamp)", () => {
		const ledger = createLedger();
		const session = createSession();
		const ancientOffsetDays = -11 * 365; // ~11 years before T0
		for (const e of [
			ev("/dev/alpha/main", "claude", ancientOffsetDays, 500),
			ev("/dev/alpha/main", "claude", 0, 100),
		])
			ingestEvent(ledger, session, e, 0);

		const ancientDayMs = T0 + ancientOffsetDays * DAY;
		const r = buildRangeResult(ledger, KNOWN, [], {
			fromMs: ancientDayMs,
			toMs: T0 + DAY,
		});

		const rowsSum = r.byWorkspace.reduce(
			(a, row) => a + row.tokens.billable,
			0,
		);
		expect(rowsSum).toBe(600);
		expect(r.earliestDayMs).toBe(ancientDayMs);
		expect(
			r.days.some(
				(d) => d.dayStartMs === ancientDayMs && d.tokens.claude === 500,
			),
		).toBe(true);
		expect(r.days.length).toBeLessThan(MAX_RANGE_DAYS); // sanity: nowhere near the clamp
	});

	// Structural defense, not a history rejection: an absurdly wide requested
	// window (far beyond any real ledger's depth) bounds the day-point WALK
	// alone — the merge (rows/byProvider/cost/earliestDayMs) iterates only the
	// ledger's own real entries and is NEVER clamped, so totals must still
	// reflect ALL ledger data, however far back it goes, even past the walk
	// clamp itself.
	it("clamp: a 50-year requested window bounds days.length at MAX_RANGE_DAYS, but byWorkspace/byProvider/cost totals still include ALL ledger data", () => {
		const ledger = createLedger();
		const session = createSession();
		const ancientOffsetDays = -11 * 365; // real, deep history — must survive the clamp in totals
		for (const e of [
			ev("/dev/alpha/main", "claude", ancientOffsetDays, 500),
			ev("/dev/alpha/main", "claude", 0, 100),
		])
			ingestEvent(ledger, session, e, 0);

		const ancientDayMs = T0 + ancientOffsetDays * DAY;
		const r = buildRangeResult(ledger, KNOWN, [], {
			fromMs: T0 - 50 * 365 * DAY, // 50 years back — far wider than any real ledger depth
			toMs: T0 + DAY,
		});

		expect(r.days.length).toBeLessThanOrEqual(MAX_RANGE_DAYS);
		const rowsSum = r.byWorkspace.reduce(
			(a, row) => a + row.tokens.billable,
			0,
		);
		const provSum = r.byProvider.reduce((a, p) => a + p.tokens, 0);
		expect(rowsSum).toBe(600);
		expect(provSum).toBe(600);
		expect(r.earliestDayMs).toBe(ancientDayMs); // the 11-year-old day, NOT clamped away
	});
});
