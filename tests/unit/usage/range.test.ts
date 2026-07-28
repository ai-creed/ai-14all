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
});
