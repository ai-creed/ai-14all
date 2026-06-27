import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const notifyToast = vi.fn();
vi.mock("../../../src/features/ui/toast/ToastProvider", () => ({
	notifyToast: (msg: string) => notifyToast(msg),
}));

import { useProcessActions } from "../../../src/app/hooks/use-process-actions";
import type { ProcessSession } from "../../../shared/models/process-session";

function makeOptions(
	createSession: () => Promise<never>,
	sendInput?: ReturnType<typeof vi.fn>,
) {
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
		sendInput: (sendInput ?? vi.fn()) as never,
		stopSession: vi.fn(),
		removeSession: vi.fn(),
	};
	return { options, dispatch };
}

function renderProcessActions(overrides: {
	createSession?: ReturnType<typeof vi.fn>;
	sendInput?: ReturnType<typeof vi.fn>;
}) {
	const createSession =
		overrides.createSession ??
		vi.fn().mockResolvedValue({ id: "term-1", status: "running" });
	const { options, dispatch } = makeOptions(
		createSession as never,
		overrides.sendInput,
	);
	const rendered = renderHook(() => useProcessActions(options));
	return { ...rendered, dispatch };
}

describe("useProcessActions spawnAdHocProcess command recording", () => {
	it("records the command/label on the ProcessSession without sending it", async () => {
		const sendInput = vi.fn().mockResolvedValue(undefined);
		const createSession = vi
			.fn()
			.mockResolvedValue({ id: "term-1", status: "running" });
		const { result } = renderProcessActions({ createSession, sendInput });

		let spawned: unknown;
		await act(async () => {
			spawned = await result.current.spawnAdHocProcess({
				command: "whisper skill install --force",
				label: "plugin install",
			});
		});
		const session = spawned as ProcessSession | null;

		// spawnAdHocProcess only RECORDS command/label on the ProcessSession; it must
		// NOT send the command, so the caller (runCommandInFloatingShell) can subscribe
		// to the session's exit BEFORE the command runs. Sending here would let a fast
		// command exit before the listener exists, dropping re-probe/auto-close.
		expect(session?.command).toBe("whisper skill install --force");
		expect(session?.label).toBe("plugin install");
		expect(sendInput).not.toHaveBeenCalled();
	});
});

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
		expect(notifyToast).toHaveBeenCalledWith("Failed to start shell");
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
