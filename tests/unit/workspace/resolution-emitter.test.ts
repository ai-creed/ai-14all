import { beforeEach, describe, expect, it } from "vitest";
import {
	__resetResolutionState,
	diffAndAdvanceResolutions,
	diffResolutions,
	type DisplayedAttentionSnapshot,
} from "../../../src/features/workspace/logic/resolution-emitter";

function snap(
	entries: Array<DisplayedAttentionSnapshot[string]>,
): DisplayedAttentionSnapshot {
	const map: DisplayedAttentionSnapshot = {};
	for (const entry of entries) map[entry.worktreeId] = entry;
	return map;
}

describe("diffResolutions", () => {
	it("emits a resolution with before:null on first appearance of a key", () => {
		const next = snap([
			{
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				state: "actionRequired",
				source: "process",
				summary: "waiting: continue?",
			},
		]);

		const changes = diffResolutions({}, next);

		expect(changes).toEqual([
			{
				type: "resolution",
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				before: null,
				after: {
					state: "actionRequired",
					source: "process",
					summary: "waiting: continue?",
				},
			},
		]);
	});

	it("returns nothing when the displayed value is unchanged", () => {
		const entry: DisplayedAttentionSnapshot[string] = {
			worktreeId: "wt-1",
			processId: "p-1",
			provider: "claude",
			state: "active",
			source: "process",
			summary: "running tests",
		};

		const changes = diffResolutions(snap([entry]), snap([{ ...entry }]));

		expect(changes).toEqual([]);
	});

	it("emits before/after when the displayed state genuinely changes", () => {
		const prev = snap([
			{
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				state: "active",
				source: "process",
				summary: "running",
			},
		]);
		const next = snap([
			{
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				state: "actionRequired",
				source: "process",
				summary: "waiting: continue?",
			},
		]);

		const changes = diffResolutions(prev, next);

		expect(changes).toEqual([
			{
				type: "resolution",
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				before: {
					state: "active",
					source: "process",
					summary: "running",
				},
				after: {
					state: "actionRequired",
					source: "process",
					summary: "waiting: continue?",
				},
			},
		]);
	});

	it("treats summary differences as a genuine change", () => {
		const base = {
			worktreeId: "wt-1",
			processId: "p-1",
			provider: "codex" as const,
			state: "active",
			source: "process",
		};
		const prev = snap([{ ...base, summary: "step 1" }]);
		const next = snap([{ ...base, summary: "step 2" }]);

		const changes = diffResolutions(prev, next);

		expect(changes).toHaveLength(1);
		expect(changes[0]?.before?.summary).toBe("step 1");
		expect(changes[0]?.after?.summary).toBe("step 2");
	});

	it("carries a null provider and processId for session-sourced display", () => {
		const next = snap([
			{
				worktreeId: "wt-1",
				processId: null,
				provider: null,
				state: "waiting",
				source: "session",
				summary: "waiting: answer question",
			},
		]);

		const changes = diffResolutions({}, next);

		expect(changes[0]?.provider).toBeNull();
		expect(changes[0]?.processId).toBeNull();
		expect(changes[0]?.after).toEqual({
			state: "waiting",
			source: "session",
			summary: "waiting: answer question",
		});
	});

	it("omits summary from snapshots when it is undefined", () => {
		const next = snap([
			{
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "other",
				state: "idle",
				source: "process",
			},
		]);

		const changes = diffResolutions({}, next);

		expect(changes[0]?.after).toEqual({ state: "idle", source: "process" });
		expect("summary" in (changes[0]?.after ?? {})).toBe(false);
	});

	it("handles multiple worktrees independently in one pass", () => {
		const prev = snap([
			{
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				state: "active",
				source: "process",
			},
			{
				worktreeId: "wt-2",
				processId: "p-2",
				provider: "codex",
				state: "idle",
				source: "process",
			},
		]);
		const next = snap([
			{
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				state: "active",
				source: "process",
			},
			{
				worktreeId: "wt-2",
				processId: "p-2",
				provider: "codex",
				state: "actionRequired",
				source: "process",
				summary: "needs input",
			},
		]);

		const changes = diffResolutions(prev, next);

		expect(changes).toHaveLength(1);
		expect(changes[0]?.worktreeId).toBe("wt-2");
		expect(changes[0]?.before).toEqual({ state: "idle", source: "process" });
	});
});

describe("diffAndAdvanceResolutions (module-scoped, StrictMode-safe)", () => {
	beforeEach(() => {
		__resetResolutionState();
	});

	it("emits first-appearance changes, then nothing on the same snapshot, then the delta on change", () => {
		const s = snap([
			{
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				state: "actionRequired",
				source: "process",
				summary: "waiting: continue?",
			},
		]);

		// First call: first-appearance resolution with before:null.
		const first = diffAndAdvanceResolutions(s);
		expect(first).toEqual([
			{
				type: "resolution",
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				before: null,
				after: {
					state: "actionRequired",
					source: "process",
					summary: "waiting: continue?",
				},
			},
		]);

		// Second call with the SAME snapshot (StrictMode's 2nd mount) emits
		// nothing — proves the module store advanced and survived the remount.
		const second = diffAndAdvanceResolutions(
			snap([
				{
					worktreeId: "wt-1",
					processId: "p-1",
					provider: "claude",
					state: "actionRequired",
					source: "process",
					summary: "waiting: continue?",
				},
			]),
		);
		expect(second).toEqual([]);

		// Third call with a genuinely changed snapshot emits the delta only.
		const third = diffAndAdvanceResolutions(
			snap([
				{
					worktreeId: "wt-1",
					processId: "p-1",
					provider: "claude",
					state: "active",
					source: "process",
					summary: "running",
				},
			]),
		);
		expect(third).toEqual([
			{
				type: "resolution",
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				before: {
					state: "actionRequired",
					source: "process",
					summary: "waiting: continue?",
				},
				after: { state: "active", source: "process", summary: "running" },
			},
		]);
	});

	it("__resetResolutionState clears the store so the next call re-emits first-appearance", () => {
		const s = snap([
			{
				worktreeId: "wt-1",
				processId: "p-1",
				provider: "claude",
				state: "active",
				source: "process",
			},
		]);

		expect(diffAndAdvanceResolutions(s)).toHaveLength(1);
		expect(diffAndAdvanceResolutions(s)).toEqual([]);

		__resetResolutionState();

		const afterReset = diffAndAdvanceResolutions(s);
		expect(afterReset).toHaveLength(1);
		expect(afterReset[0]?.before).toBeNull();
	});
});
