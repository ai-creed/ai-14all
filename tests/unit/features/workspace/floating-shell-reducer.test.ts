import { describe, it, expect } from "vitest";
import {
	createWorkspaceState,
	workspaceReducer,
	MAX_FLOATING_SHELLS,
	isFloatingShell,
	type WorkspaceState,
} from "../../../../src/features/workspace/logic/workspace-state";
import type { Worktree } from "../../../../shared/models/worktree";
import type { ProcessSession } from "../../../../shared/models/process-session";

const wt = (id: string): Worktree =>
	({
		id,
		path: `/repo/${id}`,
		branch: id,
		isPrimary: false,
	}) as unknown as Worktree;

const proc = (id: string): ProcessSession => ({
	id,
	workspaceId: "ws",
	worktreeId: "a",
	terminalSessionId: `term-${id}`,
	origin: "adHoc",
	presetId: null,
	label: `shell ${id}`,
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
});

const base = (): WorkspaceState => createWorkspaceState([wt("a")]);

describe("floating shell state init", () => {
	it("createWorkspaceState seeds empty floating fields per session", () => {
		const state = createWorkspaceState([wt("a")]);
		const session = state.sessionsByWorktreeId.a;
		expect(session.floatingShellIds).toEqual([]);
		expect(session.expandedFloatingShellId).toBeNull();
	});
});

describe("floating shell reducer actions", () => {
	it("registerFloatingShell adds to floatingShellIds (not slots) and expands it", () => {
		const next = workspaceReducer(base(), {
			type: "session/registerFloatingShell",
			worktreeId: "a",
			process: proc("p1"),
		});
		const s = next.sessionsByWorktreeId.a;
		expect(s.floatingShellIds).toEqual(["p1"]);
		expect(s.expandedFloatingShellId).toBe("p1");
		expect(s.slotProcessIds).toEqual([null]);
		expect(next.processSessionsById.p1).toBeDefined();
	});

	it("registerFloatingShell is a no-op at the cap (defensive backstop)", () => {
		let state = base();
		for (let i = 0; i < MAX_FLOATING_SHELLS; i++) {
			state = workspaceReducer(state, {
				type: "session/registerFloatingShell",
				worktreeId: "a",
				process: proc(`p${i}`),
			});
		}
		const overflow = workspaceReducer(state, {
			type: "session/registerFloatingShell",
			worktreeId: "a",
			process: proc("p-overflow"),
		});
		expect(overflow.sessionsByWorktreeId.a.floatingShellIds).toHaveLength(
			MAX_FLOATING_SHELLS,
		);
		expect(overflow.processSessionsById["p-overflow"]).toBeUndefined();
	});

	it("expand/minimize toggle the expanded id", () => {
		let state = workspaceReducer(base(), {
			type: "session/registerFloatingShell",
			worktreeId: "a",
			process: proc("p1"),
		});
		state = workspaceReducer(state, {
			type: "session/minimizeFloatingShell",
			worktreeId: "a",
			processId: "p1",
		});
		expect(state.sessionsByWorktreeId.a.expandedFloatingShellId).toBeNull();
		state = workspaceReducer(state, {
			type: "session/expandFloatingShell",
			worktreeId: "a",
			processId: "p1",
		});
		expect(state.sessionsByWorktreeId.a.expandedFloatingShellId).toBe("p1");
	});

	it("closeFloatingShell removes from floatingShellIds and processSessionsById", () => {
		let state = workspaceReducer(base(), {
			type: "session/registerFloatingShell",
			worktreeId: "a",
			process: proc("p1"),
		});
		state = workspaceReducer(state, {
			type: "session/closeFloatingShell",
			worktreeId: "a",
			processId: "p1",
		});
		expect(state.sessionsByWorktreeId.a.floatingShellIds).toEqual([]);
		expect(state.sessionsByWorktreeId.a.expandedFloatingShellId).toBeNull();
		expect(state.processSessionsById.p1).toBeUndefined();
	});

	it("closeFloatingShell is a no-op when processId is not in floatingShellIds", () => {
		// Register a slotted process and a floating one, then dispatch
		// closeFloatingShell with the SLOTTED id — must leave state unchanged.
		let state = workspaceReducer(base(), {
			type: "session/registerProcess",
			worktreeId: "a",
			process: proc("slot1"),
		});
		state = workspaceReducer(state, {
			type: "session/registerFloatingShell",
			worktreeId: "a",
			process: proc("f1"),
		});
		const before = state;
		const after = workspaceReducer(state, {
			type: "session/closeFloatingShell",
			worktreeId: "a",
			processId: "slot1",
		});
		expect(after).toBe(before);
		expect(after.processSessionsById).toEqual(before.processSessionsById);
		expect(after.sessionsByWorktreeId.a).toEqual(before.sessionsByWorktreeId.a);
	});
});

describe("pinFloatingShellToSlot", () => {
	it("moves a floating shell into the first empty slot, same id, no respawn", () => {
		let state = workspaceReducer(base(), {
			type: "session/registerFloatingShell",
			worktreeId: "a",
			process: proc("p1"),
		});
		state = workspaceReducer(state, {
			type: "session/pinFloatingShellToSlot",
			worktreeId: "a",
			processId: "p1",
		});
		const s = state.sessionsByWorktreeId.a;
		expect(s.slotProcessIds).toEqual(["p1"]); // layout "1", slot 0
		expect(s.floatingShellIds).toEqual([]);
		expect(s.expandedFloatingShellId).toBeNull();
		expect(s.activeProcessSessionId).toBe("p1");
		// same ProcessSession object id retained (terminalSessionId unchanged)
		expect(state.processSessionsById.p1.terminalSessionId).toBe("term-p1");
	});

	it("promotes the layout when the current layout has no empty slot", () => {
		// Seed a slotted shell occupying the single slot, then add a floating one.
		let state = workspaceReducer(base(), {
			type: "session/registerProcess",
			worktreeId: "a",
			process: proc("slot1"),
		});
		state = workspaceReducer(state, {
			type: "session/registerFloatingShell",
			worktreeId: "a",
			process: proc("f1"),
		});
		state = workspaceReducer(state, {
			type: "session/pinFloatingShellToSlot",
			worktreeId: "a",
			processId: "f1",
		});
		const s = state.sessionsByWorktreeId.a;
		expect(s.slotProcessIds).toContain("f1");
		expect(s.slotProcessIds.filter((x) => x !== null)).toHaveLength(2);
		expect(s.terminalLayoutId).not.toBe("1"); // grew into a 2-slot layout
		expect(s.floatingShellIds).toEqual([]);
	});

	it("is a no-op when the grid is full (6 slots)", () => {
		let state = base();
		for (let i = 0; i < 6; i++) {
			state = workspaceReducer(state, {
				type: "session/registerProcess",
				worktreeId: "a",
				process: proc(`slot${i}`),
			});
		}
		state = workspaceReducer(state, {
			type: "session/registerFloatingShell",
			worktreeId: "a",
			process: proc("f1"),
		});
		const before = state.sessionsByWorktreeId.a;
		const after = workspaceReducer(state, {
			type: "session/pinFloatingShellToSlot",
			worktreeId: "a",
			processId: "f1",
		});
		// floating shell stays floating; slots unchanged
		expect(after.sessionsByWorktreeId.a.floatingShellIds).toEqual(["f1"]);
		expect(after.sessionsByWorktreeId.a.slotProcessIds).toEqual(
			before.slotProcessIds,
		);
	});
});

describe("isFloatingShell selector", () => {
	it("is true only for ids in the worktree's floatingShellIds", () => {
		const state = workspaceReducer(base(), {
			type: "session/registerFloatingShell",
			worktreeId: "a",
			process: proc("p1"),
		});
		expect(isFloatingShell(state, "a", "p1")).toBe(true);
		expect(isFloatingShell(state, "a", "nope")).toBe(false);
		expect(isFloatingShell(state, "missing-wt", "p1")).toBe(false);
	});
});
