import { describe, expect, it } from "vitest";
import {
	buildWorkspaceRows,
	type WorkspaceIndex,
} from "../../../../src/features/insights/workspaceRows";
import {
	countRunOutcomes,
	emptyRunCounts,
	groupRunsByRepo,
	type RunOutcomeCounts,
} from "../../../../src/features/insights/runStatus";
import { buildRangeResult } from "../../../../services/usage/range";
import {
	createLedger,
	createSession,
	ingestEvent,
	startOfLocalDay,
} from "../../../../services/usage/ledger";
import type {
	KnownWorktree,
	UsageEvent,
	UsageRow,
} from "../../../../shared/models/usage";

// Two workspaces: ws1 spans two worktrees (wt1 + wt2), ws2 is single-worktree.
// Titles are deliberately NOT in alphabetical array order so the sort test
// exercises real reordering, not an accidental pass-through.
const INDEX: WorkspaceIndex = [
	{
		workspaceId: "ws1",
		title: "Zeta Workspace",
		repoId: "repo-alpha",
		rootPath: "/dev/alpha",
		worktreeCount: 2,
	},
	{
		workspaceId: "ws2",
		title: "Apex Workspace",
		repoId: null,
		rootPath: "/dev/beta",
		worktreeCount: 1,
	},
];

function rowFor(
	worktreeId: string | null,
	workspaceId: string | null,
	provider: string,
	billable: number,
	costUsd: number | null = null,
): UsageRow {
	return {
		workspaceId,
		worktreeId,
		worktreePath: worktreeId ? `/path/${worktreeId}` : null,
		worktreeTitle: worktreeId ?? "untracked",
		provider: provider as UsageRow["provider"],
		active: false,
		tokens: { input: billable, output: 0, billable, raw: billable },
		costUsd,
	};
}

function counts(partial: Partial<RunOutcomeCounts>): RunOutcomeCounts {
	return { ...emptyRunCounts(), ...partial };
}

// (f): raw-grain usage rows — one UsageRow per (worktree|untracked) x provider.
const usageRowsFixture: UsageRow[] = [
	rowFor("wt1", "ws1", "claude", 100, 1),
	rowFor("wt1", "ws1", "codex", 50, 0.5),
	rowFor("wt2", "ws1", "claude", 30, 0.3),
	rowFor("wt3", "ws2", "claude", 70, 0.7),
	rowFor(null, null, "ezio", 40, null),
	rowFor(null, null, "claude", 10, 0.1),
];

const runGroupsFixture = new Map<string | null, RunOutcomeCounts>([
	["repo-alpha", counts({ done: 2, failed: 1 })], // joins ws1 via repoId
	["repo-unknown", counts({ done: 1, halted: 1 })], // unmatched -> untracked
	[null, counts({ done: 1 })], // null -> untracked
]);

describe("buildWorkspaceRows", () => {
	it("(f) one row per workspace + untracked; mix sums; totals equal tile sums", () => {
		const { rows, totals } = buildWorkspaceRows(
			usageRowsFixture,
			runGroupsFixture,
			INDEX,
		);
		expect(rows.map((r) => r.key).sort()).toEqual(["untracked", "ws1", "ws2"]);
		for (const r of rows)
			expect(r.mix.reduce((a, m) => a + m.tokens, 0)).toBe(r.tokens);
		expect(totals.tokens).toBe(
			usageRowsFixture.reduce((a, r) => a + r.tokens.billable, 0),
		);
		expect(totals.costUsd).toBeCloseTo(
			usageRowsFixture.reduce((a, r) => a + (r.costUsd ?? 0), 0),
			10,
		);
		// run group with unmatched repoId folded into untracked:
		const untracked = rows.find((r) => r.key === "untracked")!;
		expect(untracked.runs.done).toBe(
			runGroupsFixture.get("repo-unknown")!.done +
				runGroupsFixture.get(null)!.done,
		);
	});

	it("(g) unconditional presence: zero-activity workspace row + empty untracked row; null-repoId runs fold", () => {
		const { rows, totals } = buildWorkspaceRows(
			[rowFor("wt1", "ws1", "claude", 100)], // NO untracked usage
			new Map([
				[null, counts({ done: 1 })],
				["no-such-repo", counts({ halted: 2 })],
			]),
			[
				...INDEX,
				{
					workspaceId: "ws-idle",
					title: "idle",
					repoId: "r-idle",
					rootPath: "/dev/idle",
					worktreeCount: 1,
				},
			],
		);
		const idle = rows.find((r) => r.key === "ws-idle")!;
		expect(idle.tokens).toBe(0);
		expect(idle.runs).toEqual(emptyRunCounts());
		const untracked = rows.find((r) => r.key === "untracked")!;
		expect(untracked.tokens).toBe(0);
		expect(untracked.runs.done).toBe(1);
		expect(untracked.runs.halted).toBe(2);
		const sumRuns = rows.reduce(
			(a, r) => a + Object.values(r.runs).reduce((x, y) => x + y, 0),
			0,
		);
		expect(sumRuns).toBe(3); // nothing dropped
		expect(totals.tokens).toBe(100);
	});

	it("usage row with a workspaceId missing from the index gets its OWN row (never merged into untracked)", () => {
		const { rows } = buildWorkspaceRows(
			[rowFor("wtX", "ws-ghost", "codex", 5)],
			new Map(),
			INDEX,
		);
		expect(rows.some((r) => r.key === "ws-ghost")).toBe(true);
	});

	it("sort: tokens desc, ties name asc, untracked last within its tie group", () => {
		const { rows } = buildWorkspaceRows([], new Map(), INDEX); // all zero
		expect(rows[rows.length - 1].key).toBe("untracked");
		const names = rows.slice(0, -1).map((r) => r.name);
		expect(names).toEqual([...names].sort());
	});

	// Composed (f)+(h): the REAL pipeline — buildRangeResult (worker) →
	// buildWorkspaceRows (VM) — compared against the TILE sources, class by
	// class, with untracked data present and the popover config OFF. This is
	// the test a duplicate-row / dropped-status / filtered-untracked
	// regression cannot pass.
	describe("composed with buildRangeResult", () => {
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
			{
				worktreeId: "wt3",
				workspaceId: "ws2",
				title: "main",
				path: "/dev/beta",
			},
		];
		const INDEX_WITH_REPO_WS1: WorkspaceIndex = INDEX.map((w) =>
			w.workspaceId === "ws1" ? { ...w, repoId: "repo-ws1" } : w,
		);

		// Task 7's `seeded()` ledger builder, duplicated verbatim (it is a
		// local, unexported helper in tests/unit/usage/range.test.ts).
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
		function seededLedger() {
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

		it("(f/h, composed) range -> view-model totals equal the tile sums exactly — tokens, cost.total, and ALL FIVE run classes", () => {
			const range = buildRangeResult(seededLedger(), KNOWN, [], {
				fromMs: T0,
				toMs: T0 + 3 * DAY,
			});
			// One run of EVERY known status + one unknown, spread across repo keys
			// (ws1's repoId, an unmatched repoId, and null):
			const statuses = [
				"done",
				"halted",
				"failed",
				"running",
				"paused",
				"canceled",
				"archived-v2",
			];
			const runs = statuses.map((status, i) => ({
				repoId: i < 3 ? "repo-ws1" : i < 5 ? "repo-unmatched" : null,
				status,
			}));
			const tiles = countRunOutcomes(runs.map((r) => r.status)); // the TILE source (§4.9)
			const vm = buildWorkspaceRows(
				range.byWorkspace,
				groupRunsByRepo(runs),
				INDEX_WITH_REPO_WS1,
			);
			// tokens: tiles read Σ days; the table totals must equal it exactly:
			const tileTokens = range.days.reduce(
				(a, d) => a + Object.values(d.tokens).reduce((x, y) => x + (y ?? 0), 0),
				0,
			);
			expect(vm.totals.tokens).toBe(tileTokens);
			// cost: table totals equal the range cost snapshot the cost tile shows:
			expect(vm.totals.costUsd ?? 0).toBeCloseTo(range.cost.total, 10);
			// runs: EVERY §4.9 class equal, tile vs table — nothing dropped, nothing
			// mislabeled:
			expect(vm.totals.runs).toEqual(tiles);
			expect(tiles).toEqual({
				done: 1,
				halted: 2,
				failed: 1,
				active: 2,
				other: 1,
			});
			// untracked row present with the popover config conceptually OFF — the
			// VM has no includeUntracked input at all (decision 14), asserted by
			// signature:
			expect(vm.rows.some((r) => r.key === "untracked")).toBe(true);
			expect(buildWorkspaceRows.length).toBe(3); // (usageRows, runGroups, workspaces) — no config arg
		});
	});
});
