import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		read: vi.fn(),
	},
	git: {
		discardChange: vi.fn(),
	},
}));

import { ChangesList } from "../../../src/features/git/components/ChangesList";
import { files } from "../../../src/lib/desktop-client";

const mockRead = vi.mocked(files.read);

describe("ChangesList", () => {
	it("renders changed files with status badges", () => {
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[
					{ path: "src/index.ts", status: "M" },
					{ path: "src/new-file.ts", status: "??" },
				]}
				selectedPath="src/new-file.ts"
				onSelect={vi.fn()}
				onDiscardChange={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("button", { name: /src\/index\.ts/i }),
		).toBeInTheDocument();
		expect(screen.getByText("??")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /src\/new-file\.ts/i }),
		).toHaveAttribute("data-selected", "true");
	});

	it("calls onSelect when a file is clicked", () => {
		const onSelect = vi.fn();
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[{ path: "src/index.ts", status: "M" }]}
				selectedPath={null}
				onSelect={onSelect}
				onDiscardChange={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /src\/index\.ts/i }));
		expect(onSelect).toHaveBeenCalledWith("src/index.ts");
	});

	it("shows error message when gitSummaryError is true", () => {
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[]}
				selectedPath={null}
				onSelect={() => {}}
				onDiscardChange={vi.fn()}
				gitSummaryError
			/>,
		);
		expect(screen.getByText("Unable to load Git data.")).toBeInTheDocument();
		expect(screen.queryByText("No changed files.")).not.toBeInTheDocument();
	});

	it("wraps the empty state in a padded rail message container", () => {
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[]}
				selectedPath={null}
				onSelect={() => {}}
				onDiscardChange={vi.fn()}
			/>,
		);

		expect(screen.getByText("No changed files.").parentElement).toHaveClass(
			"shell-rail__message",
		);
	});

	it("shows Preview for markdown files and opens the preview modal", async () => {
		mockRead.mockResolvedValueOnce({
			ok: true,
			view: {
				path: "NOTES.md",
				content: "# Preview Test\n",
				language: "markdown",
			},
		});

		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[
					{ path: "NOTES.md", status: "M" },
					{ path: "src/index.ts", status: "M" },
				]}
				selectedPath={null}
				onSelect={vi.fn()}
				onDiscardChange={vi.fn()}
			/>,
		);

		fireEvent.contextMenu(screen.getByRole("button", { name: /notes\.md/i }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Preview" }));

		expect(
			await screen.findByRole("heading", { name: "Preview Test" }),
		).toBeInTheDocument();
		expect(mockRead).toHaveBeenCalledWith(
			"workspace:test",
			"wt-test",
			"NOTES.md",
		);
	});

	it("does not show Preview for non-markdown changed files", () => {
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[{ path: "src/index.ts", status: "M" }]}
				selectedPath={null}
				onSelect={vi.fn()}
				onDiscardChange={vi.fn()}
			/>,
		);

		fireEvent.contextMenu(
			screen.getByRole("button", { name: /src\/index\.ts/i }),
		);
		expect(
			screen.queryByRole("menuitem", { name: "Preview" }),
		).not.toBeInTheDocument();
	});

	it("shows Discard in context menu for all files", () => {
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[{ path: "src/index.ts", status: "M" }]}
				selectedPath={null}
				onSelect={vi.fn()}
				onDiscardChange={vi.fn()}
			/>,
		);
		fireEvent.contextMenu(
			screen.getByRole("button", { name: /src\/index\.ts/i }),
		);
		expect(
			screen.getByRole("menuitem", { name: "Discard changes" }),
		).toBeInTheDocument();
	});

	it("shows both Preview and Discard for markdown files", () => {
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[{ path: "NOTES.md", status: "M" }]}
				selectedPath={null}
				onSelect={vi.fn()}
				onDiscardChange={vi.fn()}
			/>,
		);
		fireEvent.contextMenu(screen.getByRole("button", { name: /notes\.md/i }));
		expect(
			screen.getByRole("menuitem", { name: "Preview" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("menuitem", { name: "Discard changes" }),
		).toBeInTheDocument();
	});

	it("renders [N] badge next to file name when openCommentCounts has entries", () => {
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[{ path: "src/foo.ts", status: "M" }]}
				selectedPath={null}
				onSelect={() => {}}
				onDiscardChange={() => {}}
				openCommentCounts={{ "src/foo.ts": 3 }}
			/>,
		);
		expect(screen.getByText(/\[3\]/)).toBeInTheDocument();
	});

	it("calls onDiscardChange with path when Discard is clicked", () => {
		const onDiscardChange = vi.fn();
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[{ path: "src/index.ts", status: "M" }]}
				selectedPath={null}
				onSelect={vi.fn()}
				onDiscardChange={onDiscardChange}
			/>,
		);
		fireEvent.contextMenu(
			screen.getByRole("button", { name: /src\/index\.ts/i }),
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Discard changes" }));
		expect(onDiscardChange).toHaveBeenCalledWith("src/index.ts");
	});

	it("shows an interactive Viewed toggle only on the open row", () => {
		const onToggleViewed = vi.fn();
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[
					{ path: "src/open.ts", status: "M" },
					{ path: "src/other.ts", status: "M" },
				]}
				selectedPath="src/open.ts"
				onSelect={vi.fn()}
				onDiscardChange={vi.fn()}
				onToggleViewed={onToggleViewed}
				reviewedPaths={[]}
			/>,
		);
		// Exactly one toggle, on the open row.
		const toggles = screen.getAllByTestId("mark-viewed-toggle");
		expect(toggles).toHaveLength(1);
		fireEvent.click(toggles[0]);
		expect(onToggleViewed).toHaveBeenCalledWith("src/open.ts");
	});

	it("keeps the toggle a sibling of the file-select button (no nested buttons)", () => {
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[{ path: "src/open.ts", status: "M" }]}
				selectedPath="src/open.ts"
				onSelect={vi.fn()}
				onDiscardChange={vi.fn()}
				onToggleViewed={vi.fn()}
				reviewedPaths={[]}
			/>,
		);
		const toggle = screen.getByTestId("mark-viewed-toggle");
		const selectButton = screen.getByRole("button", { name: /src\/open\.ts/i });
		// The toggle must NOT be nested inside the file-select button (invalid DOM).
		expect(selectButton).not.toContainElement(toggle);
		// Both controls are siblings within the same row container.
		const row = toggle.closest(".shell-list__item-row");
		expect(row).not.toBeNull();
		expect(selectButton.closest(".shell-list__item-row")).toBe(row);
	});

	it("keeps a read-only reviewed mark on non-open reviewed rows", () => {
		render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[
					{ path: "src/open.ts", status: "M" },
					{ path: "src/done.ts", status: "M" },
				]}
				selectedPath="src/open.ts"
				onSelect={vi.fn()}
				onDiscardChange={vi.fn()}
				onToggleViewed={vi.fn()}
				reviewedPaths={["src/done.ts"]}
			/>,
		);
		// Non-open reviewed row shows the read-only mark, not a toggle.
		expect(screen.getByTestId("reviewed-mark-src/done.ts")).toBeInTheDocument();
		expect(screen.getAllByTestId("mark-viewed-toggle")).toHaveLength(1);
	});

	it("makes the toggle live after a non-open row is selected", () => {
		const onSelect = vi.fn();
		const onToggleViewed = vi.fn();
		const { rerender } = render(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[
					{ path: "src/a.ts", status: "M" },
					{ path: "src/b.ts", status: "M" },
				]}
				selectedPath={null}
				onSelect={onSelect}
				onDiscardChange={vi.fn()}
				onToggleViewed={onToggleViewed}
				reviewedPaths={[]}
			/>,
		);
		// No open row yet → no interactive toggle anywhere.
		expect(screen.queryAllByTestId("mark-viewed-toggle")).toHaveLength(0);
		// Clicking a non-open row selects it.
		fireEvent.click(screen.getByRole("button", { name: /src\/b\.ts/i }));
		expect(onSelect).toHaveBeenCalledWith("src/b.ts");
		// The parent promotes it to the open row → its toggle is now live.
		rerender(
			<ChangesList
				workspaceId="workspace:test"
				worktreeId="wt-test"
				changes={[
					{ path: "src/a.ts", status: "M" },
					{ path: "src/b.ts", status: "M" },
				]}
				selectedPath="src/b.ts"
				onSelect={onSelect}
				onDiscardChange={vi.fn()}
				onToggleViewed={onToggleViewed}
				reviewedPaths={[]}
			/>,
		);
		const toggles = screen.getAllByTestId("mark-viewed-toggle");
		expect(toggles).toHaveLength(1);
		fireEvent.click(toggles[0]);
		expect(onToggleViewed).toHaveBeenCalledWith("src/b.ts");
	});
});
