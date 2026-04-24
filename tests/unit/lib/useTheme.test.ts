import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "../../../src/lib/useTheme";

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
});
