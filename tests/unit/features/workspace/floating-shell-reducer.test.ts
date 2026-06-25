import { describe, it, expect } from "vitest";
import {
	createWorkspaceState,
	workspaceReducer,
	MAX_FLOATING_SHELLS,
	type WorkspaceState,
} from "../../../../src/features/workspace/logic/workspace-state";
import type { Worktree } from "../../../../shared/models/worktree";
import type { ProcessSession } from "../../../../shared/models/process-session";

const wt = (id: string): Worktree =>
	({ id, path: `/repo/${id}`, branch: id, isPrimary: false }) as unknown as Worktree;

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
});
