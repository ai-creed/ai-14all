import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { TerminalWatchStateEvent } from "../../../shared/contracts/events";

const listeners: Array<(ev: TerminalWatchStateEvent) => void> = [];
vi.mock("../../../src/lib/desktop-client", () => ({
	terminals: {
		onWatchState: vi.fn((l: (ev: TerminalWatchStateEvent) => void) => {
			listeners.push(l);
			return () => {};
		}),
		getWatchState: vi.fn(async () => null),
		notifyBlur: vi.fn(async () => {}),
	},
}));

import { usePhoneWatchState } from "../../../src/features/terminals/hooks/use-phone-watch-state";
import { terminals } from "../../../src/lib/desktop-client";

const owned = (
	over?: Partial<TerminalWatchStateEvent>,
): TerminalWatchStateEvent => ({
	sessionId: "term-1",
	phoneOwned: true,
	cols: 46,
	rows: 58,
	provider: "claude",
	label: "claude",
	since: 1000,
	...over,
});
const emit = (ev: TerminalWatchStateEvent) =>
	act(() => listeners.forEach((l) => l(ev)));

beforeEach(() => {
	listeners.length = 0;
	vi.mocked(terminals.getWatchState).mockResolvedValue(null);
});

describe("usePhoneWatchState (R2 — child spec §5/§6)", () => {
	it("freezes on phone-owned, captures bytes without exposing them for repaint, unfreezes on watch-end", () => {
		const { result } = renderHook(() => usePhoneWatchState("term-1"));
		expect(result.current.chip).toBeNull();
		expect(result.current.frozenRef.current).toBe(false);
		emit(owned());
		expect(result.current.frozenRef.current).toBe(true);
		expect(result.current.chip).toMatchObject({ label: "claude", since: 1000 });
		act(() => result.current.captureWatchBytes("narrow bytes"));
		expect(result.current.readPleatBytes()).toBe("narrow bytes");
		emit(owned({ phoneOwned: false, cols: null, rows: null }));
		expect(result.current.frozenRef.current).toBe(false);
		expect(result.current.chip).toBeNull();
		expect(result.current.pleat).toMatchObject({
			from: 1000,
			cols: 46,
			rows: 58,
		});
		expect(result.current.pleat?.to).not.toBeNull();
		expect(result.current.readPleatBytes()).toBe("narrow bytes"); // preview keeps them
	});

	it("ignores events for other sessions", () => {
		const { result } = renderHook(() => usePhoneWatchState("term-1"));
		emit(owned({ sessionId: "other" }));
		expect(result.current.frozenRef.current).toBe(false);
	});

	it("a geometry update within the SAME watch (same since) does not reset the pleat buffer", () => {
		const { result } = renderHook(() => usePhoneWatchState("term-1"));
		emit(owned({ cols: 46 }));
		act(() => result.current.captureWatchBytes("a"));
		emit(owned({ cols: 58, rows: 46 })); // rotation, same since
		expect(result.current.readPleatBytes()).toBe("a");
		emit(owned({ phoneOwned: false, cols: null, rows: null }));
		emit(owned({ since: 2000 })); // NEW watch replaces the pleat
		expect(result.current.readPleatBytes()).toBe("");
		expect(result.current.pleat).toMatchObject({ from: 2000, to: null });
	});

	it("seeds frozen state from getWatchState on mount (pane mounted mid-watch)", async () => {
		vi.mocked(terminals.getWatchState).mockResolvedValue(owned());
		const { result } = renderHook(() => usePhoneWatchState("term-1"));
		await waitFor(() => expect(result.current.frozenRef.current).toBe(true));
		expect(terminals.getWatchState).toHaveBeenCalledWith("term-1");
	});

	it("dismissPleat clears the pleat and its bytes", () => {
		const { result } = renderHook(() => usePhoneWatchState("term-1"));
		emit(owned());
		act(() => result.current.captureWatchBytes("x"));
		emit(owned({ phoneOwned: false, cols: null, rows: null }));
		act(() => result.current.dismissPleat());
		expect(result.current.pleat).toBeNull();
		expect(result.current.readPleatBytes()).toBe("");
	});

	// CARRIED CONSTRAINT (Task 5 review): the main process's grace-fires-after-
	// reclaim path can emit `ended` (phoneOwned:false) twice for the same watch,
	// with no dedupe in ipc. A second `ended` with no intervening owned event
	// must be a no-op: it must not overwrite `pleat.to` or clear the bytes.
	it("is idempotent on a duplicate `ended` event (no intervening owned event)", () => {
		const { result } = renderHook(() => usePhoneWatchState("term-1"));
		emit(owned());
		act(() => result.current.captureWatchBytes("bytes"));
		emit(owned({ phoneOwned: false, cols: null, rows: null }));
		const firstTo = result.current.pleat?.to;
		expect(firstTo).not.toBeNull();
		expect(firstTo).not.toBeUndefined();
		const bytesAfterFirstEnded = result.current.readPleatBytes();

		emit(owned({ phoneOwned: false, cols: null, rows: null }));

		expect(result.current.pleat?.to).toBe(firstTo);
		expect(result.current.readPleatBytes()).toBe(bytesAfterFirstEnded);
	});

	// Re-assert-after-reclaim: a phone-owned event carrying the SAME `since` as
	// the just-closed pleat re-opens it (`to` back to null) and byte capture
	// continues appending rather than resetting the buffer.
	it("re-asserting phone-owned with the SAME since re-opens the closed pleat and keeps appending bytes", () => {
		const { result } = renderHook(() => usePhoneWatchState("term-1"));
		emit(owned());
		act(() => result.current.captureWatchBytes("first"));
		emit(owned({ phoneOwned: false, cols: null, rows: null }));
		expect(result.current.pleat?.to).not.toBeNull();

		emit(owned()); // re-assert, same `since: 1000`
		expect(result.current.pleat?.to).toBeNull();
		expect(result.current.frozenRef.current).toBe(true);
		act(() => result.current.captureWatchBytes(" second"));
		expect(result.current.readPleatBytes()).toBe("first second");
	});

	it("returned functions and frozenRef are identity-stable across re-renders", () => {
		const { result, rerender } = renderHook(() => usePhoneWatchState("term-1"));
		const first = {
			captureWatchBytes: result.current.captureWatchBytes,
			readPleatBytes: result.current.readPleatBytes,
			dismissPleat: result.current.dismissPleat,
			frozenRef: result.current.frozenRef,
		};
		emit(owned());
		rerender();
		expect(result.current.captureWatchBytes).toBe(first.captureWatchBytes);
		expect(result.current.readPleatBytes).toBe(first.readPleatBytes);
		expect(result.current.dismissPleat).toBe(first.dismissPleat);
		expect(result.current.frozenRef).toBe(first.frozenRef);
	});
});
