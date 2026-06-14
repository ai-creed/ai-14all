import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import { MOUNT_PENDING_TIMEOUT_MS } from "../../../src/features/terminals/logic/agent-launch";
import { useMountPendingGuard } from "../../../src/features/terminals/logic/use-mount-pending-guard";

const state = (
	over: Partial<WhisperWorktreeState> = {},
): WhisperWorktreeState => ({
	worktreeId: "w1",
	collabId: "c1",
	daemonAlive: false,
	liveFeed: "polling",
	bindings: [],
	workflow: null,
	escalation: null,
	handoffs: [],
	...over,
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useMountPendingGuard", () => {
	it("starts idle (not pending)", () => {
		const { result } = renderHook(() => useMountPendingGuard(state()));
		expect(result.current.mountPending).toBe(false);
	});

	it("beginMount opens the pending window", () => {
		const { result } = renderHook(() =>
			useMountPendingGuard(state({ daemonAlive: false })),
		);
		act(() => result.current.beginMount());
		expect(result.current.mountPending).toBe(true);
	});

	it("clears the window when the lens advances (daemon comes alive)", () => {
		const { result, rerender } = renderHook(
			({ s }) => useMountPendingGuard(s),
			{ initialProps: { s: state({ daemonAlive: false }) } },
		);
		act(() => result.current.beginMount());
		expect(result.current.mountPending).toBe(true);
		rerender({ s: state({ daemonAlive: true }) });
		expect(result.current.mountPending).toBe(false);
	});

	it("clears after the timeout even if the lens never advances", () => {
		vi.useFakeTimers();
		const { result } = renderHook(() =>
			useMountPendingGuard(state({ daemonAlive: false })),
		);
		act(() => result.current.beginMount());
		expect(result.current.mountPending).toBe(true);
		act(() => {
			vi.advanceTimersByTime(MOUNT_PENDING_TIMEOUT_MS + 100);
		});
		expect(result.current.mountPending).toBe(false);
	});
});
