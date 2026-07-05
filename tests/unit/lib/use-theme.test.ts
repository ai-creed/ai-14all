import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "../../../src/lib/use-theme";

type ChangeListener = (e: Pick<MediaQueryListEvent, "matches">) => void;

function mockMatchMedia(systemIsLight: boolean) {
	const listeners: ChangeListener[] = [];
	const mql = {
		matches: systemIsLight,
		addEventListener: (_: string, cb: ChangeListener) => {
			listeners.push(cb);
		},
		removeEventListener: (_: string, cb: ChangeListener) => {
			const idx = listeners.indexOf(cb);
			if (idx > -1) listeners.splice(idx, 1);
		},
	};
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockReturnValue(mql),
	});
	return {
		mql,
		listeners,
		triggerChange: (matches: boolean) => {
			listeners.forEach((cb) => cb({ matches }));
		},
	};
}

let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
	originalMatchMedia = window.matchMedia;
	document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: originalMatchMedia,
	});
	vi.restoreAllMocks();
});

describe("useTheme", () => {
	it("sets data-theme=dark when system preference is dark", () => {
		mockMatchMedia(false);
		renderHook(() => useTheme());
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
	});

	it("sets data-theme=light when system preference is light", () => {
		mockMatchMedia(true);
		renderHook(() => useTheme());
		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
	});

	it("updates data-theme when system preference changes to light", () => {
		const { triggerChange } = mockMatchMedia(false);
		renderHook(() => useTheme());
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
		act(() => triggerChange(true));
		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
	});

	it("updates data-theme when system preference changes to dark", () => {
		const { triggerChange } = mockMatchMedia(true);
		renderHook(() => useTheme());
		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
		act(() => triggerChange(false));
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
	});

	it("setTheme('light') overrides system preference", () => {
		mockMatchMedia(false); // system is dark
		const { result } = renderHook(() => useTheme());
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
		act(() => result.current.setTheme("light"));
		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
	});

	it("setTheme('system') reverts to system preference", () => {
		mockMatchMedia(true); // system is light
		const { result } = renderHook(() => useTheme());
		act(() => result.current.setTheme("dark")); // override to dark
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
		act(() => result.current.setTheme("system")); // revert
		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
	});

	it("returns the correct resolvedTheme value", () => {
		mockMatchMedia(true);
		const { result } = renderHook(() => useTheme());
		expect(result.current.resolvedTheme).toBe("light");
	});

	it("setTheme('warm') applies the warm palette", () => {
		mockMatchMedia(true); // system is light
		const { result } = renderHook(() => useTheme());
		act(() => result.current.setTheme("warm"));
		expect(document.documentElement.getAttribute("data-theme")).toBe("warm");
	});

	it("maps the warm palette to a dark resolvedTheme for Monaco", () => {
		mockMatchMedia(true);
		const { result } = renderHook(() => useTheme());
		act(() => result.current.setTheme("warm"));
		expect(result.current.resolvedTheme).toBe("dark");
	});

	it("returns the selected mode in the mode field", () => {
		mockMatchMedia(false); // system is dark
		const { result } = renderHook(() => useTheme());
		// initial mode is "system"
		expect(result.current.mode).toBe("system");
		act(() => result.current.setTheme("dark"));
		expect(result.current.mode).toBe("dark");
		act(() => result.current.setTheme("light"));
		expect(result.current.mode).toBe("light");
		act(() => result.current.setTheme("system"));
		expect(result.current.mode).toBe("system");
	});

	it("boots from settings.initial when the bridge is present", () => {
		mockMatchMedia(false);
		(window as unknown as { ai14all: unknown }).ai14all = {
			settings: { initial: { theme: "warm" }, write: vi.fn() },
			events: {},
		};
		const { result } = renderHook(() => useTheme());
		expect(result.current.mode).toBe("warm");
		expect(document.documentElement.getAttribute("data-theme")).toBe("warm");
		delete (window as unknown as { ai14all?: unknown }).ai14all;
	});

	it("setTheme() writes the pick through the settings bridge", () => {
		mockMatchMedia(false);
		const write = vi.fn().mockResolvedValue(undefined);
		(window as unknown as { ai14all: unknown }).ai14all = {
			settings: { write },
			events: {},
		};
		const { result } = renderHook(() => useTheme());
		act(() => result.current.setTheme("dark"));
		expect(write).toHaveBeenCalledWith({ theme: "dark" });
		delete (window as unknown as { ai14all?: unknown }).ai14all;
	});

	it("routes application-menu theme picks through the write-through setTheme", () => {
		mockMatchMedia(false);
		const write = vi.fn().mockResolvedValue(undefined);
		let menuHandler: ((mode: "light" | "dark" | "system") => void) | null =
			null;
		(window as unknown as { ai14all: unknown }).ai14all = {
			settings: { write },
			events: {
				onSetTheme: (h: (mode: "light" | "dark" | "system") => void) => {
					menuHandler = h;
					return () => {
						menuHandler = null;
					};
				},
			},
		};
		const { result } = renderHook(() => useTheme());
		act(() => menuHandler!("dark"));
		expect(result.current.mode).toBe("dark");
		expect(write).toHaveBeenCalledWith({ theme: "dark" });
		delete (window as unknown as { ai14all?: unknown }).ai14all;
	});

	it("converges when settings change elsewhere (onSettingsChanged)", () => {
		mockMatchMedia(false);
		let changedHandler: ((s: { theme: string }) => void) | null = null;
		(window as unknown as { ai14all: unknown }).ai14all = {
			settings: { write: vi.fn() },
			events: {
				onSettingsChanged: (h: (s: { theme: string }) => void) => {
					changedHandler = h;
					return () => {
						changedHandler = null;
					};
				},
			},
		};
		const { result } = renderHook(() => useTheme());
		act(() => changedHandler!({ theme: "light" }));
		expect(result.current.mode).toBe("light");
		delete (window as unknown as { ai14all?: unknown }).ai14all;
	});
});
