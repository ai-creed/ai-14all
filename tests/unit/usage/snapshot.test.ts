import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../../../services/usage/snapshot.js";
import { createLedger, createSession, ingestEvent } from "../../../services/usage/ledger.js";
import type { KnownWorktree, UsageEvent, UsageScope } from "../../../shared/models/usage.js";

const HOUR = 3_600_000;
const known: KnownWorktree[] = [
	{ worktreeId: "w1", workspaceId: "ws1", title: "main", path: "/Users/me/Dev/app" },
];
const ev = (over: Partial<UsageEvent>): UsageEvent => ({
	provider: "codex", timestampMs: 0, cwd: "/Users/me/Dev/app", sessionId: "s", model: "m",
	input: 5, output: 2, billable: 7, raw: 70, ...over,
});

describe("buildSnapshot coherence", () => {
	it("within each scope, totalTokens == sum(byProvider) == sum(rows), and cost is from the same window", () => {
		const ledger = createLedger();
		const session = createSession();
		const now = new Date(2026, 5, 17, 12).getTime();
		// one post-launch event (in every scope) and one pre-launch event (in week/month/all-time, NOT session)
		ingestEvent(ledger, session, ev({ timestampMs: now - HOUR, billable: 7, raw: 70 }), now - 2 * HOUR); // post-launch
		ingestEvent(ledger, session, ev({ provider: "claude", timestampMs: now - 3 * HOUR, billable: 3, raw: 30, input: 1, output: 2 }), now - 2 * HOUR); // pre-launch (before launch = now-2h? it's now-3h => pre-launch)
		const snap = buildSnapshot({
			ledger, session, known, activeWorktreeIds: ["w1"], nowMs: now,
			includeUntracked: false, chipRange: "week",
			providersWithData: new Set(["codex", "claude"]), codexLimits: null,
		});
		for (const scope of ["session", "week", "month", "all-time"] as UsageScope[]) {
			const sd = snap.scopes[scope];
			const byProv = sd.byProvider.reduce((a, r) => a + r.tokens, 0);
			const byRows = sd.rows.reduce((a, r) => a + r.tokens.billable, 0);
			expect(sd.totalTokens).toBe(byProv);
			expect(sd.totalTokens).toBe(byRows);
			// cost is built from this scope; never $0 when there are tokens
			if (sd.totalTokens > 0) expect(sd.cost.total).toBeGreaterThan(0);
		}
		// pre-launch event excluded from session, included in all-time
		expect(snap.scopes.session.totalTokens).toBe(7);
		expect(snap.scopes["all-time"].totalTokens).toBe(10);
	});

	it("emits both chart series and all four scope keys", () => {
		const snap = buildSnapshot({
			ledger: createLedger(), session: createSession(), known, activeWorktreeIds: [],
			nowMs: Date.now(), includeUntracked: false, chipRange: "month",
			providersWithData: new Set(), codexLimits: null,
		});
		expect(Object.keys(snap.scopes).sort()).toEqual(["all-time", "month", "session", "week"]);
		expect(Array.isArray(snap.seriesDaily)).toBe(true);
		expect(Array.isArray(snap.seriesHourly)).toBe(true);
		expect(snap.config).toEqual({ chipRange: "month", includeUntracked: false });
	});
});
