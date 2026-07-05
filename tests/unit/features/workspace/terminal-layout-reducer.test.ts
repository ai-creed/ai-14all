import { describe, it, expect } from "vitest";
import {
	workspaceReducer,
	createWorkspaceState,
} from "../../../../src/features/workspace/logic/workspace-state";
import type { ProcessSession } from "../../../../shared/models/process-session";
import type { LayoutId } from "../../../../shared/models/terminal-layout";

const WT = { id: "wt1", path: "/wt1", branch: "b", isPrimary: true } as never;

function proc(id: string): ProcessSession {
	return {
		id,
		workspaceId: "ws1",
		worktreeId: "wt1",
		terminalSessionId: `t-${id}`,
		origin: "adHoc",
		presetId: null,
		label: id,
		command: null,
		status: "running",
		lastActivityAt: null,
		lastOutputPreview: null,
		exitCode: null,
		pinned: false,
		attentionState: "idle",
		agentAttentionReasons: {},
		agentAttentionClearedAt: null,
		agentDetected: false,
		provider: null,
		resumeCommand: null,
		resumePending: false,
	};
}

// Seed a session with the given layout and slot occupants.
function seed(slotIds: (string | null)[], layoutId: LayoutId = "1") {
	let s = createWorkspaceState([WT]);
	s = workspaceReducer(s, {
		type: "session/setTerminalLayout",
		worktreeId: "wt1",
		layoutId,
	});
	for (let i = 0; i < slotIds.length; i++) {
		const id = slotIds[i];
		if (id)
			s = workspaceReducer(s, {
				type: "session/setSlotProcess",
				worktreeId: "wt1",
				slotIndex: i,
				processId: id,
			});
	}
	return s;
}

describe("session/setTerminalLayout", () => {
	it("rejects a layout smaller than running shells", () => {
		const s = seed(["a", "b", "c"], "3-v");
		const next = workspaceReducer(s, {
			type: "session/setTerminalLayout",
			worktreeId: "wt1",
			layoutId: "2-v",
		});
		expect(next.sessionsByWorktreeId["wt1"].terminalLayoutId).toBe("3-v");
		expect(next.sessionsByWorktreeId["wt1"].slotProcessIds).toEqual([
			"a",
			"b",
			"c",
		]);
	});
	it("compacts running shells into a larger layout", () => {
		const s = seed(["a", "b"], "2-v");
		const next = workspaceReducer(s, {
			type: "session/setTerminalLayout",
			worktreeId: "wt1",
			layoutId: "4-grid",
		});
		expect(next.sessionsByWorktreeId["wt1"].slotProcessIds).toEqual([
			"a",
			"b",
			null,
			null,
		]);
		expect(next.sessionsByWorktreeId["wt1"].terminalLayoutId).toBe("4-grid");
	});
});

describe("session/placeProcessInNewSlot", () => {
	it("registers the process and places it at the given slot, growing the layout", () => {
		const s = seed(["a", "b", "c"], "3-vm");
		const next = workspaceReducer(s, {
			type: "session/placeProcessInNewSlot",
			worktreeId: "wt1",
			process: proc("d"),
			layoutId: "4-vm",
			slotIndex: 3,
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.terminalLayoutId).toBe("4-vm");
		expect(sess.slotProcessIds).toEqual(["a", "b", "c", "d"]);
		expect(sess.processSessionIds).toEqual(["a", "b", "c", "d"]);
		expect(sess.activeProcessSessionId).toBe("d");
		expect(next.processSessionsById["d"]).toBeDefined();
	});

	it("fills a gap slot in the current layout without killing later shells", () => {
		// Mirrors the in-grid "+ start a shell" CTA path: close a middle shell,
		// then place a new shell into the resulting empty slot of the SAME layout.
		let s = seed(["a", "b", "c"], "3-v");
		s = workspaceReducer(s, {
			type: "session/closeProcess",
			worktreeId: "wt1",
			processId: "b",
		});
		expect(s.sessionsByWorktreeId["wt1"].slotProcessIds).toEqual([
			"a",
			null,
			"c",
		]);

		const next = workspaceReducer(s, {
			type: "session/placeProcessInNewSlot",
			worktreeId: "wt1",
			process: proc("d"),
			layoutId: "3-v",
			slotIndex: 1,
		});
		const sess = next.sessionsByWorktreeId["wt1"];

		// The new shell fills the gap; "c" must keep its slot, not be overwritten.
		expect(sess.slotProcessIds).toEqual(["a", "d", "c"]);
		expect(sess.processSessionIds).toEqual(["a", "d", "c"]);
		expect(sess.terminalLayoutId).toBe("3-v");
	});
});

describe("session/registerProcess (slot model)", () => {
	it("fills a gap left by a closed middle shell without killing later shells", () => {
		// Layout 3, all slots full, close the MIDDLE shell -> [a, null, c].
		let s = seed(["a", "b", "c"], "3-v");
		s = workspaceReducer(s, {
			type: "session/closeProcess",
			worktreeId: "wt1",
			processId: "b",
		});
		expect(s.sessionsByWorktreeId["wt1"].slotProcessIds).toEqual([
			"a",
			null,
			"c",
		]);

		// Adding a new shell must fill the gap and leave every existing shell
		// untouched — previously the layout was compacted before placement, which
		// overwrote "c" and orphaned its running process.
		const next = workspaceReducer(s, {
			type: "session/registerProcess",
			worktreeId: "wt1",
			process: proc("d"),
		});
		const sess = next.sessionsByWorktreeId["wt1"];

		expect(sess.slotProcessIds).toEqual(["a", "d", "c"]);
		expect(sess.processSessionIds).toEqual(["a", "d", "c"]);
		// "d" is the freshly registered process; "c" must remain present.
		expect(next.processSessionsById["d"]).toBeDefined();
		expect(sess.activeProcessSessionId).toBe("d");
		expect(sess.terminalLayoutId).toBe("3-v");
	});

	it("promotes the layout bucket and appends when no slot is empty", () => {
		const s = seed(["a", "b", "c"], "3-v");
		const next = workspaceReducer(s, {
			type: "session/registerProcess",
			worktreeId: "wt1",
			process: proc("d"),
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.slotProcessIds.filter((id) => id !== null)).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
		expect(sess.slotProcessIds[3]).toBe("d");
	});
});

describe("session/closeProcess (slot model)", () => {
	it("empties the slot without changing the layout", () => {
		let s = seed(["a", "b", "c"], "3-v");
		for (const id of ["a", "b", "c"])
			s = {
				...s,
				processSessionsById: { ...s.processSessionsById, [id]: proc(id) },
			};
		const next = workspaceReducer(s, {
			type: "session/closeProcess",
			worktreeId: "wt1",
			processId: "b",
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.terminalLayoutId).toBe("3-v");
		expect(sess.slotProcessIds).toEqual(["a", null, "c"]);
		expect(sess.processSessionIds).toEqual(["a", "c"]);
	});
	it("resets to single when the last shell closes", () => {
		let s = seed(["a"], "1");
		s = {
			...s,
			processSessionsById: { ...s.processSessionsById, a: proc("a") },
		};
		const next = workspaceReducer(s, {
			type: "session/closeProcess",
			worktreeId: "wt1",
			processId: "a",
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.terminalLayoutId).toBe("1");
		expect(sess.slotProcessIds).toEqual([null]);
		expect(sess.activeProcessSessionId).toBeNull();
	});
	it("focuses the NEAREST remaining slot (not remaining[0]) when the active slot closes", () => {
		let s = seed(["a", "b", "c"], "3-v"); // seed sets active to last placed ("c")
		for (const id of ["a", "b", "c"])
			s = {
				...s,
				processSessionsById: { ...s.processSessionsById, [id]: proc(id) },
			};
		const next = workspaceReducer(s, {
			type: "session/closeProcess",
			worktreeId: "wt1",
			processId: "c",
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.slotProcessIds).toEqual(["a", "b", null]);
		expect(sess.activeProcessSessionId).toBe("b"); // nearest, NOT "a"
	});
	it("keeps focus when a non-active slot closes", () => {
		let s = seed(["a", "b", "c"], "3-v"); // active = "c"
		for (const id of ["a", "b", "c"])
			s = {
				...s,
				processSessionsById: { ...s.processSessionsById, [id]: proc(id) },
			};
		const next = workspaceReducer(s, {
			type: "session/closeProcess",
			worktreeId: "wt1",
			processId: "a",
		});
		expect(next.sessionsByWorktreeId["wt1"].activeProcessSessionId).toBe("c");
	});
});

describe("session/swapTerminalSlots", () => {
	it("swaps two slot occupants (promote child to master)", () => {
		const s = seed(["m", "c1", "c2"], "3-vm");
		const next = workspaceReducer(s, {
			type: "session/swapTerminalSlots",
			worktreeId: "wt1",
			i: 1,
			j: 0,
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.slotProcessIds).toEqual(["c1", "m", "c2"]);
		// Invariant: processSessionIds === non-null slots, in slot order.
		expect(sess.processSessionIds).toEqual(
			sess.slotProcessIds.filter((id) => id !== null),
		);
		expect(sess.processSessionIds).toEqual(["c1", "m", "c2"]);
	});

	it("preserves the invariant when swapping with an empty slot", () => {
		const s = seed(["m", null, "c2"], "3-vm");
		const next = workspaceReducer(s, {
			type: "session/swapTerminalSlots",
			worktreeId: "wt1",
			i: 1,
			j: 0,
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.slotProcessIds).toEqual([null, "m", "c2"]);
		expect(sess.processSessionIds).toEqual(
			sess.slotProcessIds.filter((id) => id !== null),
		);
		expect(sess.processSessionIds).toEqual(["m", "c2"]);
	});
});

describe("session/setSlotProcess bounds", () => {
	it("is a no-op for an out-of-range slot index", () => {
		const s = seed(["a", null], "2-v");
		const next = workspaceReducer(s, {
			type: "session/setSlotProcess",
			worktreeId: "wt1",
			slotIndex: 5,
			processId: "x",
		});
		expect(next.sessionsByWorktreeId["wt1"].slotProcessIds).toEqual([
			"a",
			null,
		]);
	});
	it("keeps the slot array length equal to the layout slot count after a write", () => {
		const s = seed(["a", null], "2-v");
		const next = workspaceReducer(s, {
			type: "session/setSlotProcess",
			worktreeId: "wt1",
			slotIndex: 1,
			processId: "b",
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.slotProcessIds).toEqual(["a", "b"]);
		expect(sess.slotProcessIds).toHaveLength(2);
	});
});

describe("migration hydration (session/restoreSnapshot)", () => {
	function snapshot(over: Record<string, unknown>) {
		return {
			worktreeId: "wt1",
			title: "",
			note: "",
			reviewMode: "files",
			viewerMode: "file",
			selectedFilePath: null,
			selectedChangedFilePath: null,
			selectedCommitSha: null,
			selectedCommitFilePath: null,
			activeProcessSessionId: null,
			reviewSidebarWidth: 280,
			nextAdHocNumber: 1,
			processSessions: [],
			...over,
		} as never;
	}
	const procSnap = (id: string) => ({
		id,
		origin: "adHoc",
		presetId: null,
		label: id,
		command: null,
		pinned: false,
	});

	it("resets an OLD snapshot (no slot fields) with many processes to single + one kept shell", () => {
		const s = createWorkspaceState([WT]);
		const next = workspaceReducer(s, {
			type: "session/restoreSnapshot",
			workspaceId: "ws1",
			snapshot: snapshot({
				activeProcessSessionId: "p2",
				processSessions: [procSnap("p1"), procSnap("p2"), procSnap("p3")],
				// terminalLayoutId / slotProcessIds intentionally ABSENT
			}),
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.terminalLayoutId).toBe("1");
		expect(sess.slotProcessIds).toEqual(["p2"]);
		expect(sess.processSessionIds).toEqual(["p2"]);
		expect(next.processSessionsById["p1"]).toBeUndefined();
		expect(next.processSessionsById["p3"]).toBeUndefined();
	});

	it("restores a NEW snapshot's layout + slots (sanitizing stale ids)", () => {
		const s = createWorkspaceState([WT]);
		const next = workspaceReducer(s, {
			type: "session/restoreSnapshot",
			workspaceId: "ws1",
			snapshot: snapshot({
				terminalLayoutId: "3-v",
				slotProcessIds: ["p1", null, "p3"],
				activeProcessSessionId: "p1",
				processSessions: [procSnap("p1"), procSnap("p3")],
			}),
		});
		const sess = next.sessionsByWorktreeId["wt1"];
		expect(sess.terminalLayoutId).toBe("3-v");
		expect(sess.slotProcessIds).toEqual(["p1", null, "p3"]);
		expect(sess.processSessionIds).toEqual(["p1", "p3"]);
	});
});
