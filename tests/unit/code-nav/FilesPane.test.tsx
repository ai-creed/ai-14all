import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigate = vi.fn(async () => {});
const symbolResults = vi.fn(() => [] as unknown[]);
const worktreeStatus = vi.fn(() => ({
	available: true,
	ready: true,
	reason: null as string | null,
	dirtyAtIndex: false,
	sourceFingerprint: null,
	sourceIndexedAt: null,
}));

// Mount counter lets us prove FilesPane keeps WorktreeTree mounted across a
// mode toggle (so files.listWorktree is not refired) — spec edge case 4.
const treeMounts = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../../src/features/viewer/components/WorktreeTree.js", async () => {
	const react = await vi.importActual<typeof import("react")>("react");
	return {
		WorktreeTree: ({ searchTerm }: { searchTerm: string }) => {
			react.useEffect(() => {
				treeMounts.n += 1;
			}, []);
			return react.createElement(
				"div",
				{ "data-testid": "worktree-tree" },
				"tree:" + searchTerm,
			);
		},
	};
});
vi.mock("../../../src/features/code-nav/palette/use-symbol-search.js", () => ({
	useSymbolSearch: (ref: unknown) => ({
		results: ref ? symbolResults() : [],
		loading: false,
		error: null,
	}),
}));
vi.mock(
	"../../../src/features/code-nav/palette/use-worktree-status.js",
	() => ({
		useWorktreeStatus: (ref: unknown) => (ref ? worktreeStatus() : null),
	}),
);
vi.mock("../../../src/features/code-nav/nav/active-worktree-ref.js", () => ({
	getActiveWorktreeRef: () => ({ workspaceId: "ws1", worktreeId: "wt1" }),
}));
vi.mock("../../../src/features/code-nav/nav/router-singleton.js", () => ({
	getNavRouter: () => ({ navigate }),
}));
vi.mock("../../../src/features/code-nav/ipc/client.js", () => ({
	codeNavClient: { refreshWorktree: vi.fn() },
}));

import { FilesPane } from "../../../src/app/components/FilesPane";

const baseProps = {
	workspaceId: "ws1",
	worktreeId: "wt1",
	worktreeLabel: "main",
	selectedFile: null,
	onSelect: () => {},
	changedFiles: [],
	expandedPaths: [],
	onExpandedPathsChange: () => {},
	showIgnored: false,
	onToggleShowIgnored: () => {},
	onRequestClose: () => {},
};

describe("FilesPane", () => {
	it("renders the tree in files mode and forwards the query as searchTerm", async () => {
		render(<FilesPane {...baseProps} mode="files" onModeChange={() => {}} />);
		await userEvent.type(screen.getByPlaceholderText("Search files…"), "abc");
		expect(screen.getByTestId("worktree-tree")).toHaveTextContent("tree:abc");
	});

	it("switches the input placeholder when toggling to symbols mode", async () => {
		const onModeChange = vi.fn();
		render(
			<FilesPane {...baseProps} mode="files" onModeChange={onModeChange} />,
		);
		await userEvent.click(screen.getByRole("button", { name: /symbols/i }));
		expect(onModeChange).toHaveBeenCalledWith("symbols");
	});

	it("navigates on Enter in symbols mode WITHOUT closing the overlay", async () => {
		symbolResults.mockReturnValue([
			{
				id: 1,
				qualified_name: "foo",
				bare_name: "foo",
				file: "src/foo.ts",
				line: 12,
				exported: 1,
				is_default: 0,
				is_declaration_only: 0,
				col: 5,
				end_line: 12,
				end_col: 8,
			},
		]);
		navigate.mockClear();
		const onRequestClose = vi.fn();
		render(
			<FilesPane
				{...baseProps}
				mode="symbols"
				onModeChange={() => {}}
				onRequestClose={onRequestClose}
			/>,
		);
		const input = screen.getByPlaceholderText("Search symbols…");
		await userEvent.type(input, "foo{Enter}");
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				file: "src/foo.ts",
				line: 12,
				column: 5,
				source: "palette",
			}),
		);
		// Navigation lands in this overlay's editor — the overlay must stay open.
		expect(onRequestClose).not.toHaveBeenCalled();
		symbolResults.mockReturnValue([]);
	});

	it("ArrowDown/ArrowUp move the cursor; Enter picks the cursor row", async () => {
		const rows = [
			{
				id: 1,
				qualified_name: "alpha",
				bare_name: "alpha",
				file: "src/a.ts",
				line: 1,
				exported: 1,
				is_default: 0,
				is_declaration_only: 0,
				col: 1,
				end_line: 1,
				end_col: 5,
			},
			{
				id: 2,
				qualified_name: "alphabet",
				bare_name: "alphabet",
				file: "src/b.ts",
				line: 2,
				exported: 1,
				is_default: 0,
				is_declaration_only: 0,
				col: 3,
				end_line: 2,
				end_col: 9,
			},
		];
		symbolResults.mockReturnValue(rows);
		navigate.mockClear();
		render(<FilesPane {...baseProps} mode="symbols" onModeChange={() => {}} />);
		const input = screen.getByPlaceholderText("Search symbols…");
		// cursor 0 → Down(1) → Down(clamped 1) → Up(0) → Down(1): lands on row 2.
		await userEvent.type(
			input,
			"alph{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}{Enter}",
		);
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ file: "src/b.ts", line: 2, column: 3 }),
		);
		symbolResults.mockReturnValue([]);
	});

	it("closes the overlay on Escape in symbols mode", async () => {
		const onRequestClose = vi.fn();
		render(
			<FilesPane
				{...baseProps}
				mode="symbols"
				onModeChange={() => {}}
				onRequestClose={onRequestClose}
			/>,
		);
		await userEvent.type(
			screen.getByPlaceholderText("Search symbols…"),
			"{Escape}",
		);
		expect(onRequestClose).toHaveBeenCalled();
	});

	it("skips the symbol search and shows the unavailable banner when the worktree has no index", () => {
		worktreeStatus.mockReturnValue({
			available: false,
			ready: false,
			reason: "not-indexed",
			dirtyAtIndex: false,
			sourceFingerprint: null,
			sourceIndexedAt: null,
		});
		symbolResults.mockClear();
		render(<FilesPane {...baseProps} mode="symbols" onModeChange={() => {}} />);
		expect(screen.getByTestId("code-nav-unavailable-banner")).toBeTruthy();
		// No searchSymbols IPC is attempted for an unindexed worktree — otherwise
		// every keystroke throws CortexIndexNotReadyError in the main process.
		expect(symbolResults).not.toHaveBeenCalled();
		// Restore the default available status for any later tests.
		worktreeStatus.mockReturnValue({
			available: true,
			ready: true,
			reason: null,
			dirtyAtIndex: false,
			sourceFingerprint: null,
			sourceIndexedAt: null,
		});
	});

	it("keeps WorktreeTree mounted across Files→Symbols→Files (no refetch)", () => {
		treeMounts.n = 0;
		const { rerender } = render(
			<FilesPane {...baseProps} mode="files" onModeChange={() => {}} />,
		);
		expect(treeMounts.n).toBe(1);
		rerender(
			<FilesPane {...baseProps} mode="symbols" onModeChange={() => {}} />,
		);
		rerender(<FilesPane {...baseProps} mode="files" onModeChange={() => {}} />);
		// Never unmounted/remounted → WorktreeTree's reload effect (which calls
		// files.listWorktree) does not refire on a mode toggle.
		expect(treeMounts.n).toBe(1);
	});
});
