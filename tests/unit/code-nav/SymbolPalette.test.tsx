import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const useWorktreeStatus = vi.fn();
vi.mock(
	"../../../src/features/code-nav/palette/use-worktree-status.js",
	() => ({ useWorktreeStatus: () => useWorktreeStatus() }),
);
vi.mock("../../../src/features/code-nav/palette/use-symbol-search.js", () => ({
	useSymbolSearch: () => ({ results: [], loading: false, error: null }),
}));
vi.mock("../../../src/features/code-nav/nav/active-worktree-ref.js", () => ({
	getActiveWorktreeRef: () => ({ workspaceId: "ws1", worktreeId: "wt1" }),
}));
vi.mock("../../../src/features/code-nav/nav/router-singleton.js", () => ({
	getNavRouter: () => null,
}));
vi.mock("../../../src/features/code-nav/ipc/client.js", () => ({
	codeNavClient: { refreshWorktree: vi.fn() },
}));

import { SymbolPalette } from "../../../src/features/code-nav/palette/SymbolPalette.js";

const base = {
	ready: false,
	dirtyAtIndex: false,
	sourceFingerprint: null,
	sourceIndexedAt: null,
};

describe("SymbolPalette disable path", () => {
	it("hides the search input and shows the reason message when unavailable", () => {
		useWorktreeStatus.mockReturnValue({
			...base,
			available: false,
			reason: "no-cortex",
		});
		render(<SymbolPalette open onClose={() => {}} />);
		expect(
			screen.getByTestId("code-nav-unavailable-banner"),
		).toHaveTextContent(/install ai-cortex/i);
		expect(screen.queryByTestId("symbol-search-input")).toBeNull();
	});

	it("shows the unsupported-schema message when reason is unsupported-schema", () => {
		useWorktreeStatus.mockReturnValue({
			...base,
			available: false,
			reason: "unsupported-schema",
		});
		render(<SymbolPalette open onClose={() => {}} />);
		expect(
			screen.getByTestId("code-nav-unavailable-banner"),
		).toHaveTextContent(/update ai-cortex/i);
	});

	it("renders the search input when available", () => {
		useWorktreeStatus.mockReturnValue({
			...base,
			available: true,
			ready: true,
			reason: null,
		});
		render(<SymbolPalette open onClose={() => {}} />);
		expect(screen.getByTestId("symbol-search-input")).toBeTruthy();
		expect(screen.queryByTestId("code-nav-unavailable-banner")).toBeNull();
	});
});
