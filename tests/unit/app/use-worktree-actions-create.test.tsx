import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const createWorktree = vi.fn();
vi.mock("../../../src/lib/desktop-client", () => ({
	repository: {
		createWorktree: (...args: unknown[]) => createWorktree(...args),
		removeWorktree: vi.fn(),
	},
}));

import { useWorktreeActions } from "../../../src/app/hooks/use-worktree-actions";

const CREATED_WORKTREE = {
	id: "worktree:new",
	label: "feature-x",
	branchName: "feature-x",
	path: "/repo/.worktrees/feature-x",
	isMain: false,
};

const CREATE_PREVIEW = {
	name: "feature-x",
	branchName: "feature-x",
	path: "/repo/.worktrees/feature-x",
	baseRef: "origin/main",
	baseCommit: { sha: "abc123", shortSha: "abc123", subject: "init" },
};

function makeOptions(overrides?: { createSessionTitle?: string }) {
	// Records the relative order of the inventory refresh and any setTitle
	// dispatch so we can prove the title is applied AFTER the session exists.
	const order: string[] = [];
	const dispatch = vi.fn((action: { type: string }) => {
		if (action.type === "session/setTitle") order.push("setTitle");
	});
	const refreshWorktreeInventory = vi.fn(async () => {
		order.push("refresh");
	});

	const options = {
		workspaceId: "ws1",
		workspaceStateRef: { current: { sessionsByWorktreeId: {} } } as never,
		createPreview: CREATE_PREVIEW as never,
		createName: "feature-x",
		createBaseBranch: "origin/devel",
		createSessionTitle: overrides?.createSessionTitle ?? "My title",
		setCreateBusy: vi.fn(),
		setCreateDialogOpen: vi.fn(),
		setCreateName: vi.fn(),
		setCreateSessionTitle: vi.fn(),
		setCreatePreview: vi.fn(),
		setCreateError: vi.fn(),
		removePreview: null,
		setRemoveBusy: vi.fn(),
		setRemoveDialogOpen: vi.fn(),
		setRemoveTargetId: vi.fn(),
		setRemovePreview: vi.fn(),
		setRemoveError: vi.fn(),
		dispatch,
		stopSession: vi.fn(),
		removeSession: vi.fn(),
		forgetDefaultShellEnsuredForWorktree: vi.fn(),
		refreshWorktreeInventory,
	};
	return { options, dispatch, refreshWorktreeInventory, order };
}

describe("useWorktreeActions create", () => {
	beforeEach(() => {
		createWorktree.mockReset();
		createWorktree.mockResolvedValue(CREATED_WORKTREE);
	});

	it("applies the session title only after the worktree session exists", async () => {
		const { options, dispatch, order } = makeOptions();
		const { result } = renderHook(() => useWorktreeActions(options));

		await act(async () => {
			await result.current.handleConfirmCreateWorktree();
		});

		// The reducer that creates the session runs during refreshWorktreeInventory;
		// setTitle must fire after it, otherwise updateSession no-ops and the title
		// is dropped.
		expect(order).toEqual(["refresh", "setTitle"]);
		expect(dispatch).toHaveBeenCalledWith({
			type: "session/setTitle",
			worktreeId: CREATED_WORKTREE.id,
			title: "My title",
		});
	});

	it("does not dispatch setTitle when the title is blank", async () => {
		const { options, dispatch } = makeOptions({ createSessionTitle: "   " });
		const { result } = renderHook(() => useWorktreeActions(options));

		await act(async () => {
			await result.current.handleConfirmCreateWorktree();
		});

		expect(dispatch).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/setTitle" }),
		);
	});

	it("passes the selected base branch to createWorktree", async () => {
		const { options } = makeOptions();
		const { result } = renderHook(() => useWorktreeActions(options));

		await act(async () => {
			await result.current.handleConfirmCreateWorktree();
		});

		expect(createWorktree).toHaveBeenCalledWith(
			"ws1",
			"feature-x",
			"origin/devel",
		);
	});
});
