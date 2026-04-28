import { describe, it, expect, vi } from "vitest";
import {
	installNoteBridgeReceiver,
	type WorkspaceLookup,
} from "../../../../src/features/workspace/note-bridge-receiver";
import type { WorkspaceState } from "../../../../src/features/workspace/workspace-state";
import type { NoteBridgeReply } from "../../../../shared/contracts/note-bridge";

function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
	return {
		selectedWorktreeId: null,
		commandPresets: [],
		processSessionsById: {},
		sessionsByWorktreeId: {},
		nextAdHocNumberByWorktreeId: {},
		...overrides,
	};
}

function makeSession(worktreeId: string, note: string) {
	return {
		id: `s-${worktreeId}`,
		worktreeId,
		title: "t",
		note,
		reviewMode: "files" as const,
		reviewDrawerOpen: false,
		viewerMode: "file" as const,
		gitSummary: null,
		gitSummaryStale: false,
		gitSummaryMessage: null,
		gitSummaryError: false,
		selectedFilePath: null,
		selectedChangedFilePath: null,
		selectedCommitSha: null,
		selectedCommitFilePath: null,
		activeProcessSessionId: null,
		processSessionIds: [],
		attentionState: "idle" as const,
		terminalLayoutMode: "single" as const,
		splitLeftProcessId: null,
		splitRightProcessId: null,
		reviewSidebarWidth: 320,
		treeExpandedPaths: [],
	};
}

function makeApi() {
	let requestHandler: ((req: unknown) => void) | null = null;
	const api = {
		onRequest: vi.fn((h: (req: unknown) => void) => {
			requestHandler = h;
			return () => {
				requestHandler = null;
			};
		}),
		sendReply: vi.fn(),
		sendReady: vi.fn(),
		sendGoodbye: vi.fn(),
	};
	return {
		api,
		fire: (req: unknown) => requestHandler?.(req),
	};
}

const FIXED_NOW = new Date("2026-04-28T14:32:09");

describe("installNoteBridgeReceiver", () => {
	it("on install, calls sendReady; on unsubscribe, calls sendGoodbye", () => {
		const { api } = makeApi();
		const lookup: WorkspaceLookup = { forEach: () => {} };
		const off = installNoteBridgeReceiver({
			workspaces: lookup,
			dispatchTo: vi.fn(),
			api,
			now: () => FIXED_NOW,
		});
		expect(api.sendReady).toHaveBeenCalledTimes(1);
		off();
		expect(api.sendGoodbye).toHaveBeenCalledTimes(1);
	});

	it("op:read replies with the matched session note", () => {
		const { api, fire } = makeApi();
		const state = makeState({
			sessionsByWorktreeId: { "wt-1": makeSession("wt-1", "hello") },
		});
		const lookup: WorkspaceLookup = {
			forEach: (cb) => cb("ws-A", state),
		};
		installNoteBridgeReceiver({
			workspaces: lookup,
			dispatchTo: vi.fn(),
			api,
			now: () => FIXED_NOW,
		});
		fire({ id: "r1", op: "read", worktreeId: "wt-1" });
		expect(api.sendReply).toHaveBeenCalledWith({
			id: "r1",
			ok: true,
			op: "read",
			note: "hello",
		} satisfies NoteBridgeReply);
	});

	it("op:append into empty note builds the canonical section format", () => {
		const { api, fire } = makeApi();
		const dispatch = vi.fn();
		const state = makeState({
			sessionsByWorktreeId: { "wt-1": makeSession("wt-1", "") },
		});
		installNoteBridgeReceiver({
			workspaces: { forEach: (cb) => cb("ws-A", state) },
			dispatchTo: dispatch,
			api,
			now: () => FIXED_NOW,
		});
		fire({
			id: "a1",
			op: "append",
			worktreeId: "wt-1",
			title: "Idea",
			body: "body",
		});
		const expectedSection = "## Idea — 2026-04-28 14:32";
		const expectedNote = `${expectedSection}\n\nbody`;
		expect(dispatch).toHaveBeenCalledWith("ws-A", {
			type: "session/setNote",
			worktreeId: "wt-1",
			note: expectedNote,
		});
		expect(api.sendReply).toHaveBeenCalledWith({
			id: "a1",
			ok: true,
			op: "append",
			note: expectedNote,
			appendedSection: expectedSection,
		} satisfies NoteBridgeReply);
	});

	it("op:append into existing note prepends two newlines", () => {
		const { api, fire } = makeApi();
		const dispatch = vi.fn();
		const state = makeState({
			sessionsByWorktreeId: { "wt-1": makeSession("wt-1", "previous") },
		});
		installNoteBridgeReceiver({
			workspaces: { forEach: (cb) => cb("ws-A", state) },
			dispatchTo: dispatch,
			api,
			now: () => FIXED_NOW,
		});
		fire({
			id: "a2",
			op: "append",
			worktreeId: "wt-1",
			title: "T",
			body: "B",
		});
		const expected = "previous\n\n## T — 2026-04-28 14:32\n\nB";
		expect(dispatch).toHaveBeenCalledWith(
			"ws-A",
			expect.objectContaining({ note: expected }),
		);
	});

	it("finds session in inactive workspace and dispatches into the owning workspaceId", () => {
		const { api, fire } = makeApi();
		const dispatch = vi.fn();
		const active = makeState({ sessionsByWorktreeId: {} });
		const inactive = makeState({
			sessionsByWorktreeId: { "wt-9": makeSession("wt-9", "x") },
		});
		installNoteBridgeReceiver({
			workspaces: {
				forEach: (cb) => {
					cb("ws-active", active);
					cb("ws-inactive", inactive);
				},
			},
			dispatchTo: dispatch,
			api,
			now: () => FIXED_NOW,
		});
		fire({
			id: "r2",
			op: "read",
			worktreeId: "wt-9",
		});
		expect(api.sendReply).toHaveBeenCalledWith({
			id: "r2",
			ok: true,
			op: "read",
			note: "x",
		});
		fire({
			id: "a3",
			op: "append",
			worktreeId: "wt-9",
			title: "t",
			body: "b",
		});
		// dispatch must be called with "ws-inactive", not "ws-active"
		expect(dispatch).toHaveBeenCalledWith("ws-inactive", expect.any(Object));
	});

	it("unknown worktreeId yields no_session and does not dispatch", () => {
		const { api, fire } = makeApi();
		const dispatch = vi.fn();
		installNoteBridgeReceiver({
			workspaces: { forEach: (cb) => cb("ws-A", makeState()) },
			dispatchTo: dispatch,
			api,
			now: () => FIXED_NOW,
		});
		fire({ id: "r3", op: "read", worktreeId: "wt-missing" });
		expect(dispatch).not.toHaveBeenCalled();
		expect(api.sendReply).toHaveBeenCalledWith({
			id: "r3",
			ok: false,
			error: "no_session",
			message: expect.any(String),
		});
	});

	it("zero-pads single-digit timestamp components", () => {
		const { api, fire } = makeApi();
		const oneDigit = new Date("2026-01-02T03:04:05");
		const state = makeState({
			sessionsByWorktreeId: { "wt-1": makeSession("wt-1", "") },
		});
		installNoteBridgeReceiver({
			workspaces: { forEach: (cb) => cb("ws-A", state) },
			dispatchTo: vi.fn(),
			api,
			now: () => oneDigit,
		});
		fire({
			id: "a4",
			op: "append",
			worktreeId: "wt-1",
			title: "x",
			body: "y",
		});
		const reply = api.sendReply.mock.calls[0][0] as {
			appendedSection: string;
		};
		expect(reply.appendedSection).toBe("## x — 2026-01-02 03:04");
	});
});
