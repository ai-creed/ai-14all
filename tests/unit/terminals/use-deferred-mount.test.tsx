import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import { useDeferredMount } from "../../../src/features/terminals/logic/use-deferred-mount";

function state(opts: {
	daemonAlive: boolean;
	bound: number;
}): WhisperWorktreeState {
	return {
		worktreeId: "w",
		collabId: "c",
		daemonAlive: opts.daemonAlive,
		liveFeed: "polling",
		bindings: Array.from({ length: opts.bound }, () => ({
			bindingState: "bound" as const,
		})) as WhisperWorktreeState["bindings"],
		workflow: null,
	} as WhisperWorktreeState;
}

describe("useDeferredMount", () => {
	it("fires onReady once mountInFlight clears and a slot is free", () => {
		const onReady = vi.fn();
		const onTimeout = vi.fn();
		const { result, rerender } = renderHook(
			({ inFlight, s }) =>
				useDeferredMount({
					whisperState: s,
					mountInFlight: inFlight,
					onReady,
					onTimeout,
				}),
			{
				initialProps: {
					inFlight: true,
					s: state({ daemonAlive: true, bound: 0 }),
				},
			},
		);
		act(() => result.current.enqueue("codex", undefined));
		expect(result.current.deferredOccupied).toBe(true);
		// First agent binds → mount no longer in flight, one slot free.
		rerender({ inFlight: false, s: state({ daemonAlive: true, bound: 1 }) });
		expect(onReady).toHaveBeenCalledWith("codex", undefined);
		expect(result.current.deferredProvider).toBeNull();
	});

	it("does not fire while the first mount is still settling", () => {
		const onReady = vi.fn();
		const { result } = renderHook(() =>
			useDeferredMount({
				whisperState: state({ daemonAlive: true, bound: 0 }),
				mountInFlight: true,
				onReady,
				onTimeout: vi.fn(),
			}),
		);
		act(() => result.current.enqueue("codex", undefined));
		expect(onReady).not.toHaveBeenCalled();
	});

	it("ignores a second enqueue (FIFO, no replacement)", () => {
		const { result } = renderHook(() =>
			useDeferredMount({
				whisperState: state({ daemonAlive: true, bound: 0 }),
				mountInFlight: true,
				onReady: vi.fn(),
				onTimeout: vi.fn(),
			}),
		);
		act(() => result.current.enqueue("codex", undefined));
		act(() => result.current.enqueue("ezio", undefined));
		expect(result.current.deferredProvider).toBe("codex");
	});

	it("cancel clears the deferral", () => {
		const { result } = renderHook(() =>
			useDeferredMount({
				whisperState: state({ daemonAlive: true, bound: 0 }),
				mountInFlight: true,
				onReady: vi.fn(),
				onTimeout: vi.fn(),
			}),
		);
		act(() => result.current.enqueue("codex", undefined));
		act(() => result.current.cancel());
		expect(result.current.deferredOccupied).toBe(false);
	});

	it("falls back to onTimeout (vendor) if the collab never becomes ready", () => {
		vi.useFakeTimers();
		try {
			const onReady = vi.fn();
			const onTimeout = vi.fn();
			const { result } = renderHook(() =>
				useDeferredMount({
					// daemon never alive → the readiness predicate is never satisfied
					whisperState: state({ daemonAlive: false, bound: 0 }),
					mountInFlight: true,
					onReady,
					onTimeout,
				}),
			);
			act(() => result.current.enqueue("codex", 1));
			act(() => {
				vi.advanceTimersByTime(60_000 + 100);
			});
			expect(onTimeout).toHaveBeenCalledWith("codex", 1);
			expect(onReady).not.toHaveBeenCalled();
			expect(result.current.deferredOccupied).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});
