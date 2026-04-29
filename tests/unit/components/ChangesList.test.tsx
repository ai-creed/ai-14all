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

import { ChangesList } from "../../../src/features/git/ChangesList";
import { files } from "../../../src/lib/desktop-client";

const mockRead = vi.mocked(files.read);

describe("ChangesList", () => {
	it("renders changed files with status badges", () => {
		render(
			<ChangesList
				workspaceId="workspace:test" worktreeId="wt-test"
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
				workspaceId="workspace:test" worktreeId="wt-test"
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
				workspaceId="workspace:test" worktreeId="wt-test"
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
				workspaceId="workspace:test" worktreeId="wt-test"
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
			path: "NOTES.md",
			content: "# Preview Test\n",
			language: "markdown",
		});

		render(
			<ChangesList
				workspaceId="workspace:test" worktreeId="wt-test"
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
				workspaceId="workspace:test" worktreeId="wt-test"
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
				workspaceId="workspace:test" worktreeId="wt-test"
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
				workspaceId="workspace:test" worktreeId="wt-test"
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
				workspaceId="workspace:test" worktreeId="wt-test"
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
				workspaceId="workspace:test" worktreeId="wt-test"
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
});
