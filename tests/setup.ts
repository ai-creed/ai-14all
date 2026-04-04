import "@testing-library/jest-dom/vitest";

// Stub ResizeObserver for jsdom (not available in the test environment)
global.ResizeObserver = class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
};
