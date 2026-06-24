import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Node 26 exposes a native `localStorage` global that is `undefined` when
// `--localstorage-file` is not provided, shadowing jsdom's window.localStorage.
// Polyfill it globally so tests can use bare `localStorage.*` as expected.
if (typeof localStorage === "undefined") {
	const store: Record<string, string> = {};
	const localStorageMock = {
		getItem: (key: string): string | null => store[key] ?? null,
		setItem: (key: string, value: string): void => {
			store[key] = String(value);
		},
		removeItem: (key: string): void => {
			delete store[key];
		},
		clear: (): void => {
			for (const key of Object.keys(store)) {
				delete store[key];
			}
		},
		get length(): number {
			return Object.keys(store).length;
		},
		key: (index: number): string | null => Object.keys(store)[index] ?? null,
	};
	Object.defineProperty(globalThis, "localStorage", {
		value: localStorageMock,
		writable: true,
	});
}

// Stub ResizeObserver for jsdom (not available in the test environment)
global.ResizeObserver = class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
};

// Mock window.matchMedia for useTheme hook (only in browser-like environments)
if (typeof window !== "undefined") {
	const listeners: Array<(e: Pick<MediaQueryListEvent, "matches">) => void> =
		[];
	const mql = {
		matches: false, // Default to dark mode
		addEventListener: (
			_: string,
			cb: (e: Pick<MediaQueryListEvent, "matches">) => void,
		) => {
			listeners.push(cb);
		},
		removeEventListener: (
			_: string,
			cb: (e: Pick<MediaQueryListEvent, "matches">) => void,
		) => {
			const idx = listeners.indexOf(cb);
			if (idx > -1) listeners.splice(idx, 1);
		},
	};

	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockReturnValue(mql),
	});
}
