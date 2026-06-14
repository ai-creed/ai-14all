import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorktreeStatus = vi.fn();
vi.mock("../../../src/features/code-nav/ipc/client.js", () => ({
	codeNavClient: {
		getWorktreeStatus: (ref: unknown) => getWorktreeStatus(ref),
	},
}));

let unavailableCb: ((e: unknown) => void) | undefined;
vi.mock("../../../src/features/code-nav/ipc/events.js", () => ({
	subscribeWorktreeIndexRefreshed: () => () => {},
	subscribeWorktreeUnavailable: (cb: (e: unknown) => void) => {
		unavailableCb = cb;
		return () => {};
	},
	subscribeAvailabilityChanged: () => () => {},
}));

import { useWorktreeStatus } from "../../../src/features/code-nav/palette/use-worktree-status.js";

const ref = { workspaceId: "ws1", worktreeId: "wt1" };
const available = {
	available: true,
	ready: true,
	dirtyAtIndex: false,
	sourceFingerprint: "f",
	sourceIndexedAt: "t",
	reason: null,
};
const unavailable = {
	available: false,
	ready: false,
	dirtyAtIndex: false,
	sourceFingerprint: null,
	sourceIndexedAt: null,
	reason: "unsupported-schema",
};

describe("useWorktreeStatus", () => {
	beforeEach(() => {
		getWorktreeStatus.mockReset();
		unavailableCb = undefined;
		(window as unknown as { ai14all: unknown }).ai14all = { codeNav: {} };
	});

	it("returns the disable-path status fetched from the client", async () => {
		getWorktreeStatus.mockResolvedValue({
			...unavailable,
			reason: "no-cortex",
		});
		const { result } = renderHook(() => useWorktreeStatus(ref));
		await waitFor(() => expect(result.current?.reason).toBe("no-cortex"));
		expect(result.current?.available).toBe(false);
	});

	it("re-fetches status when the worktreeUnavailable push event fires", async () => {
		getWorktreeStatus
			.mockResolvedValueOnce(available)
			.mockResolvedValueOnce(unavailable);
		const { result } = renderHook(() => useWorktreeStatus(ref));
		await waitFor(() => expect(result.current?.available).toBe(true));
		await act(async () => {
			unavailableCb?.({ ...ref, reason: "unsupported-schema" });
		});
		await waitFor(() =>
			expect(result.current?.reason).toBe("unsupported-schema"),
		);
		expect(getWorktreeStatus).toHaveBeenCalledTimes(2);
	});
});
