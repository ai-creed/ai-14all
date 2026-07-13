import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_TERMINAL_FONT_SIZE,
	type FontSizeAction,
	clampFontSize,
	nextTerminalFontSize,
	persistFontSize,
	readPersistedFontSize,
	useTerminalFontSize,
} from "../../../src/features/terminals/hooks/use-terminal-font-size";

beforeEach(() => {
	localStorage.clear();
	delete (window as unknown as { ai14all?: unknown }).ai14all;
});

describe("clampFontSize", () => {
	it("clamps to [10,20] and rounds; NaN → default", () => {
		expect(clampFontSize(5)).toBe(10);
		expect(clampFontSize(99)).toBe(20);
		expect(clampFontSize(13.6)).toBe(14);
		expect(clampFontSize(Number.NaN)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
	});
});

describe("nextTerminalFontSize", () => {
	it("steps by 1 and clamps at the bounds", () => {
		expect(nextTerminalFontSize(13, "increase")).toBe(14);
		expect(nextTerminalFontSize(20, "increase")).toBe(20);
		expect(nextTerminalFontSize(10, "decrease")).toBe(10);
		expect(nextTerminalFontSize(17, "reset")).toBe(DEFAULT_TERMINAL_FONT_SIZE);
	});
});

describe("persistence", () => {
	it("defaults when empty, round-trips, and recovers from corrupt values", () => {
		expect(readPersistedFontSize()).toBe(DEFAULT_TERMINAL_FONT_SIZE);
		persistFontSize(16);
		expect(readPersistedFontSize()).toBe(16);
		localStorage.setItem("ai14all.terminalFontSize", "not-a-number");
		expect(readPersistedFontSize()).toBe(DEFAULT_TERMINAL_FONT_SIZE);
		localStorage.setItem("ai14all.terminalFontSize", "99");
		expect(readPersistedFontSize()).toBe(20); // clamped on read
	});
});

describe("useTerminalFontSize (hook boundary)", () => {
	it("applies bridge events and exposes increase/decrease/reset", () => {
		let bridgeHandler: ((a: FontSizeAction) => void) | null = null;
		const write = vi.fn().mockResolvedValue(undefined);
		(window as unknown as { ai14all: unknown }).ai14all = {
			settings: { write },
			events: {
				onAdjustTerminalFontSize: (h: (a: FontSizeAction) => void) => {
					bridgeHandler = h;
					return () => {
						bridgeHandler = null;
					};
				},
			},
		};

		const { result } = renderHook(() => useTerminalFontSize());
		expect(result.current.fontSize).toBe(13);

		// Bridge event → size change + write-through (menu-accelerator path).
		act(() => bridgeHandler!("increase"));
		expect(result.current.fontSize).toBe(14);
		expect(write).toHaveBeenLastCalledWith({ terminalFontSize: 14 });

		// Returned methods drive the same reducer.
		act(() => result.current.increase());
		expect(result.current.fontSize).toBe(15);
		act(() => result.current.decrease());
		expect(result.current.fontSize).toBe(14);
		act(() => result.current.reset());
		expect(result.current.fontSize).toBe(13);
		expect(write).toHaveBeenLastCalledWith({ terminalFontSize: 13 });
	});

	it("boots from settings.initial when the bridge is present", () => {
		(window as unknown as { ai14all: unknown }).ai14all = {
			settings: { initial: { terminalFontSize: 18 }, write: vi.fn() },
			events: {},
		};

		const { result } = renderHook(() => useTerminalFontSize());
		expect(result.current.fontSize).toBe(18);
	});

	it("converges when settings change elsewhere (onSettingsChanged)", () => {
		let changedHandler: ((s: { terminalFontSize: number }) => void) | null =
			null;
		(window as unknown as { ai14all: unknown }).ai14all = {
			settings: { write: vi.fn() },
			events: {
				onSettingsChanged: (h: (s: { terminalFontSize: number }) => void) => {
					changedHandler = h;
					return () => {
						changedHandler = null;
					};
				},
			},
		};

		const { result } = renderHook(() => useTerminalFontSize());
		expect(result.current.fontSize).toBe(13);

		act(() => changedHandler!({ terminalFontSize: 16 }));
		expect(result.current.fontSize).toBe(16);
	});
});
