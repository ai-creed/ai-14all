import { describe, expect, it } from "vitest";
import { buildRangeResult } from "../../../services/usage/range.js";
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
		// SPARSE: one point per ledger day WITH DATA in the window, not one per
		// calendar day — day T0+2*DAY has no seeded event, so it's absent, not
		// a zero-token point. Only day 0 and day 1 have data here.
		expect(r.days).toHaveLength(2);
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

	it("empty ledger: empty rows, EMPTY days array (sparse — nothing to emit), null earliestDayMs", () => {
		const r = buildRangeResult(createLedger(), KNOWN, [], {
			fromMs: T0,
			toMs: T0 + 2 * DAY,
		});
		expect(r.byWorkspace).toEqual([]);
		expect(r.earliestDayMs).toBeNull();
		expect(r.days).toEqual([]); // sparse: an empty ledger has no data days to emit
	});

	it("day points are self-normalized to local-day boundaries (the ledger's own keys, already normalized at ingest) and attribute tokens correctly", () => {
		// `days` entries come directly from `ledger.days`' own keys — always
		// startOfLocalDay-aligned already, since ingestEvent() computes the key
		// via startOfLocalDay(e.timestampMs) at write time — so this is now a
		// structural guarantee, not something buildRangeResult has to maintain
		// via a separate DST-safe walk (there is no walk anymore).
		const r = buildRangeResult(seeded(), KNOWN, [], {
			fromMs: T0,
			toMs: T0 + 3 * DAY,
		});
		for (const d of r.days) {
			expect(d.dayStartMs).toBe(startOfLocalDay(d.dayStartMs));
		}
		// Sorted ascending: day 0 first, seeded exactly claude=100, codex=50.
		expect(r.days[0].tokens).toEqual({ claude: 100, codex: 50 });
	});

	it("normalizes a mid-day fromMs to its local-day start for BOTH the merge window and the sparse day collection, so sums stay in agreement", () => {
		// Regression guard: a mid-day fromMs must feed the SAME normalized
		// `fromDay` into both the merge predicate and the sparse days-collection
		// predicate (they're literally the same `if` check, in the same loop) —
		// two different windows here would let `days` include a day the merge
		// excluded (or vice versa), breaking sum agreement.
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

	// AC3/§4.7: `all` must be able to start at the real
	// min(earliestDayMs, anchors) with NO exception, however deep the ledger
	// goes — there is no span cap, and no day-count clamp, anywhere in this
	// path (both were tried and removed as misplaced policy; see
	// services/usage/range.ts's module doc). Sparse emission makes an
	// 11-year-deep ledger unremarkable: the ancient day counts in every total
	// AND gets its own day point in `days`, exactly like any other day would.
	it("an 11-year-deep ledger: the full window sums include the ancient day, AND it gets its own day point in `days`", () => {
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
	});

	// The reviewer's exact demand (round 4, on the walk-clamp fix this sparse
	// rewrite replaced): a ledger entry BEYOND where that clamp (~27 years)
	// would have trimmed it — 30 years — must still show up in EVERY total,
	// `days` included, with no exception and no disagreement between them.
	// Sparse emission makes this a non-event: `days` and the merge draw from
	// the IDENTICAL ledger entries under the IDENTICAL predicate (the same
	// `if` in the same loop, services/usage/range.ts), so Σ days ≡ Σ
	// byWorkspace ≡ Σ byProvider by construction, for ANY window depth.
	it("a 30-year-deep ledger (beyond the old, now-removed clamp): both day points present, and Σ days === Σ byWorkspace === Σ byProvider exactly", () => {
		const ledger = createLedger();
		const session = createSession();
		const ancientOffsetDays = -30 * 365; // ~30 years before T0 — past the old ~27-year clamp
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

		// BOTH day points present — nothing trimmed, sparse or otherwise.
		expect(r.days).toHaveLength(2);
		expect(r.days.some((d) => d.dayStartMs === ancientDayMs)).toBe(true);
		expect(r.days.some((d) => d.dayStartMs === T0)).toBe(true);

		const daysSum = r.days.reduce(
			(a, d) => a + Object.values(d.tokens).reduce((x, y) => x + (y ?? 0), 0),
			0,
		);
		const rowsSum = r.byWorkspace.reduce(
			(a, row) => a + row.tokens.billable,
			0,
		);
		const provSum = r.byProvider.reduce((a, p) => a + p.tokens, 0);
		expect(daysSum).toBe(600);
		expect(rowsSum).toBe(600);
		expect(provSum).toBe(600);
		expect(daysSum).toBe(rowsSum);
		expect(daysSum).toBe(provSum);

		expect(r.earliestDayMs).toBe(ancientDayMs);
	});
});
