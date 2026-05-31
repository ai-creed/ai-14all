import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { FileView } from "../../../shared/models/file-view";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		read: vi.fn(),
	},
	workspace: {
		readRestoreState: vi.fn().mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		}),
		writeRestoreState: vi.fn(),
	},
}));

import { MarkdownPreviewModal } from "../../../src/features/viewer/components/MarkdownPreviewModal";
import { files } from "../../../src/lib/desktop-client";

const mockRead = vi.mocked(files.read);

const ok = (view: FileView) => ({ ok: true as const, view });

const fakeView: FileView = {
	path: "README.md",
	content: "# Hello\n\nSome text.\n",
	language: "markdown",
};

describe("MarkdownPreviewModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows loading state while fetching", () => {
		mockRead.mockReturnValue(new Promise(() => {}));

		render(
			<MarkdownPreviewModal
				workspaceId="workspace:test"
				worktreeId="wt-test"
				relativePath="README.md"
				open={true}
				onClose={vi.fn()}
			/>,
		);

		expect(screen.getByText("Loading README.md…")).toBeInTheDocument();
	});

	it("shows file path in header", async () => {
		mockRead.mockResolvedValueOnce({ ok: true, view: fakeView });

		render(
			<MarkdownPreviewModal
				workspaceId="workspace:test"
				worktreeId="wt-test"
				relativePath="README.md"
				open={true}
				onClose={vi.fn()}
			/>,
		);

		// Dialog.Title renders relativePath; wait for open state to settle
		expect(await screen.findByText("README.md")).toBeInTheDocument();
	});

	it("renders a markdown heading", async () => {
		mockRead.mockResolvedValueOnce({ ok: true, view: fakeView });

		render(
			<MarkdownPreviewModal
				workspaceId="workspace:test"
				worktreeId="wt-test"
				relativePath="README.md"
				open={true}
				onClose={vi.fn()}
			/>,
		);

		expect(
			await screen.findByRole("heading", { name: "Hello" }),
		).toBeInTheDocument();
	});

	it("renders a GFM table", async () => {
		mockRead.mockResolvedValueOnce(
			ok({
				...fakeView,
				content: "| A | B |\n|---|---|\n| 1 | 2 |\n",
			}),
		);

		render(
			<MarkdownPreviewModal
				workspaceId="workspace:test"
				worktreeId="wt-test"
				relativePath="README.md"
				open={true}
				onClose={vi.fn()}
			/>,
		);

		expect(await screen.findByRole("table")).toBeInTheDocument();
		expect(screen.getByText("A")).toBeInTheDocument();
		expect(screen.getByText("B")).toBeInTheDocument();
	});

	it("renders GFM task list checkboxes", async () => {
		mockRead.mockResolvedValueOnce(
			ok({
				...fakeView,
				content: "- [x] Done\n- [ ] Todo\n",
			}),
		);

		render(
			<MarkdownPreviewModal
				workspaceId="workspace:test"
				worktreeId="wt-test"
				relativePath="README.md"
				open={true}
				onClose={vi.fn()}
			/>,
		);

		const checkboxes = await screen.findAllByRole("checkbox");
		expect(checkboxes).toHaveLength(2);
		expect(checkboxes[0]).toBeChecked();
		expect(checkboxes[1]).not.toBeChecked();
	});

	it("renders a fenced code block with a language class", async () => {
		mockRead.mockResolvedValueOnce(
			ok({
				...fakeView,
				content: "```ts\nconst x = 1;\n```\n",
			}),
		);

		render(
			<MarkdownPreviewModal
				workspaceId="workspace:test"
				worktreeId="wt-test"
				relativePath="README.md"
				open={true}
				onClose={vi.fn()}
			/>,
		);

		// rehype-highlight adds language-ts class to the <code> element
		await waitFor(() => {
			expect(document.querySelector("code.language-ts")).not.toBeNull();
		});
	});

	it("shows error and Retry button when fetch fails", async () => {
		mockRead.mockRejectedValueOnce(new Error("not found"));

		render(
			<MarkdownPreviewModal
				workspaceId="workspace:test"
				worktreeId="wt-test"
				relativePath="README.md"
				open={true}
				onClose={vi.fn()}
			/>,
		);

		expect(
			await screen.findByText("Couldn't load file contents."),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});

	it("re-fetches when Retry is clicked", async () => {
		mockRead
			.mockRejectedValueOnce(new Error("fail"))
			.mockResolvedValueOnce({ ok: true, view: fakeView });

		render(
			<MarkdownPreviewModal
				workspaceId="workspace:test"
				worktreeId="wt-test"
				relativePath="README.md"
				open={true}
				onClose={vi.fn()}
			/>,
		);

		await screen.findByText("Couldn't load file contents.");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(
			await screen.findByRole("heading", { name: "Hello" }),
		).toBeInTheDocument();
		expect(mockRead).toHaveBeenCalledTimes(2);
	});

	it("calls onClose when the close button is clicked", async () => {
		mockRead.mockResolvedValueOnce({ ok: true, view: fakeView });
		const onClose = vi.fn();

		render(
			<MarkdownPreviewModal
				workspaceId="workspace:test"
				worktreeId="wt-test"
				relativePath="README.md"
				open={true}
				onClose={onClose}
			/>,
		);

		await screen.findByRole("heading", { name: "Hello" });
		const closeButtons = screen.getAllByRole("button", { name: "Close" });
		fireEvent.click(closeButtons[0]);
		expect(onClose).toHaveBeenCalled();
	});
});
