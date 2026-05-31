import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const notifyToast = vi.fn();
vi.mock("../../../src/features/ui/toast/ToastProvider", () => ({
	notifyToast: (msg: string) => notifyToast(msg),
}));

import { useProcessActions } from "../../../src/app/hooks/use-process-actions";

function makeOptions(createSession: () => Promise<never>) {
	const dispatch = vi.fn();
	const options = {
		workspaceId: "ws1",
		worktree: { id: "wt1", path: "/wt1" } as never,
		workspaceState: { commandPresets: [], processSessionsById: {} } as never,
		workspaceStateRef: { current: {} } as never,
		outputPreviewBuffersRef: { current: new Map() } as never,
		getWorkspaceStateById: () =>
			({ nextAdHocNumberByWorktreeId: { wt1: 1 } }) as never,
		createScopedWorkspaceDispatch: () => dispatch,
		sessions: [],
		createSession: createSession as never,
		sendInput: vi.fn(),
		stopSession: vi.fn(),
		removeSession: vi.fn(),
	};
	return { options, dispatch };
}

describe("useProcessActions spawn failure", () => {
	beforeEach(() => notifyToast.mockClear());

	it("toasts and dispatches nothing (no orphan slot) when the PTY spawn fails", async () => {
		const { options, dispatch } = makeOptions(() =>
			Promise.reject(new Error("boom")),
		);
		const { result } = renderHook(() => useProcessActions(options));
		await act(async () => {
			await result.current.handleAddAdHoc();
		});
		expect(notifyToast).toHaveBeenCalledWith("Failed to start shell: boom");
		expect(dispatch).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/registerProcess" }),
		);
	});

	it("spawnAdHocProcess returns null on failure", async () => {
		const { options } = makeOptions(() => Promise.reject(new Error("boom")));
		const { result } = renderHook(() => useProcessActions(options));
		let returned: unknown = "unset";
		await act(async () => {
			returned = await result.current.spawnAdHocProcess();
		});
		expect(returned).toBeNull();
	});
});
