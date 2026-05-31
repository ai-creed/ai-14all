import "@testing-library/jest-dom/vitest";
import { vi, beforeEach } from "vitest";

// By default, mark onboarding as completed so existing tests that rely on
// the repository picker being visible are not affected by the OnboardingWizard.
// Tests that specifically test onboarding should clear this in their own beforeEach.
if (typeof localStorage !== "undefined") {
	localStorage.setItem("ai14all:onboarding-completed", "true");
}
beforeEach(() => {
	if (typeof localStorage !== "undefined") {
		localStorage.setItem("ai14all:onboarding-completed", "true");
	}
});

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
