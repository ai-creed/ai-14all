import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

vi.mock("@monaco-editor/react", () => ({
	default: (props: {
		value: string;
		language: string;
		theme?: string;
		options?: { readOnly?: boolean; fontSize?: number };
	}) => (
		<div
			data-testid="monaco-editor"
			data-language={props.language}
			data-theme={props.theme}
			data-readonly={String(props.options?.readOnly ?? false)}
			data-font-size={String(props.options?.fontSize ?? "")}
		>
			{props.value}
		</div>
	),
}));

import { FileViewer } from "../../../src/features/viewer/FileViewer";
import { files } from "../../../src/lib/desktop-client";

const mockRead = vi.mocked(files.read);

const fakeFileView: FileView = {
	path: "src/index.ts",
	content: 'export const hello = "world";',
	language: "typescript",
};

describe("FileViewer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders Monaco editor with file content and readOnly", async () => {
		mockRead.mockResolvedValueOnce(fakeFileView);

		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);

		// Wait for async fetch to resolve and editor to render
		const editor = await screen.findByTestId("monaco-editor");
		expect(editor).toHaveTextContent('export const hello = "world";');
		expect(editor).toHaveAttribute("data-language", "typescript");
		expect(editor).toHaveAttribute("data-theme", "vs-dark");
		expect(editor).toHaveAttribute("data-readonly", "true");
		expect(editor).toHaveAttribute("data-font-size", "12");
	});

	it("shows file path header", async () => {
		mockRead.mockResolvedValueOnce(fakeFileView);

		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);

		expect(await screen.findByText("src/index.ts")).toBeInTheDocument();
	});

	it("shows loading state while fetching", () => {
		mockRead.mockReturnValue(new Promise(() => {}));

		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);

		expect(screen.getByText("Loading src/index.ts…")).toBeInTheDocument();
	});

	it("shows error when fetch fails", async () => {
		mockRead.mockRejectedValueOnce(new Error("File not found"));

		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="missing.ts"
				resolvedTheme="dark"
			/>,
		);

		expect(
			await screen.findByText("Error: Couldn't load file contents."),
		).toBeInTheDocument();
	});

	it("keeps the previous file view for the same target when reread fails", async () => {
		mockRead
			.mockResolvedValueOnce({
				path: "src/index.ts",
				language: "typescript",
				content: "export const hello = 'world';\n",
			})
			.mockRejectedValueOnce(new Error("read failed"));

		const { rerender } = render(
			<FileViewer
				worktreePath="/repo"
				relativePath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);
		await screen.findByText("src/index.ts");

		// Change worktreePath to trigger a re-fetch for the same relativePath.
		// The second mock call fails while relativePath still matches the cached
		// fileView.path, so the component should preserve the content and show
		// the stale message rather than clearing the view.
		rerender(
			<FileViewer
				worktreePath="/repo2"
				relativePath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);

		await waitFor(() => {
			expect(
				screen.getByText(/showing last successful result/i),
			).toBeInTheDocument();
		});
	});

	it("shows Preview context menu item when right-clicking header of a .md file", async () => {
		mockRead
			.mockResolvedValueOnce({
				path: "README.md",
				content: "# Hello",
				language: "markdown",
			})
			.mockReturnValue(new Promise(() => {})); // preview modal fetch never resolves

		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="README.md"
				resolvedTheme="dark"
			/>,
		);

		const title = await screen.findByText("README.md");
		fireEvent.contextMenu(title);

		expect(
			await screen.findByRole("menuitem", { name: "Preview" }),
		).toBeInTheDocument();
	});

	it("does not show a context menu when right-clicking header of a non-.md file without onEditFile", async () => {
		mockRead.mockResolvedValueOnce({
			path: "src/index.ts",
			content: "const x = 1;",
			language: "typescript",
		});

		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);

		const title = await screen.findByText("src/index.ts");
		fireEvent.contextMenu(title);

		expect(
			screen.queryByRole("menuitem", { name: "Preview" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("menuitem", { name: "Edit" }),
		).not.toBeInTheDocument();
	});

	it("shows Edit context menu item for editable files when onEditFile is provided", async () => {
		mockRead.mockResolvedValueOnce({
			path: "src/index.ts",
			content: "const x = 1;",
			language: "typescript",
		});

		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="src/index.ts"
				resolvedTheme="dark"
				onEditFile={vi.fn()}
			/>,
		);

		const title = await screen.findByText("src/index.ts");
		fireEvent.contextMenu(title);

		expect(
			await screen.findByRole("menuitem", { name: "Edit" }),
		).toBeInTheDocument();
	});

	it("calls onEditFile with relativePath when Edit is clicked", async () => {
		mockRead.mockResolvedValueOnce({
			path: "src/index.ts",
			content: "const x = 1;",
			language: "typescript",
		});

		const onEditFile = vi.fn();
		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="src/index.ts"
				resolvedTheme="dark"
				onEditFile={onEditFile}
			/>,
		);

		const title = await screen.findByText("src/index.ts");
		fireEvent.contextMenu(title);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));

		expect(onEditFile).toHaveBeenCalledWith("src/index.ts");
	});

	it("shows both Preview and Edit for .md files when onEditFile is provided", async () => {
		mockRead
			.mockResolvedValueOnce({
				path: "README.md",
				content: "# Hello",
				language: "markdown",
			})
			.mockReturnValue(new Promise(() => {}));

		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="README.md"
				resolvedTheme="dark"
				onEditFile={vi.fn()}
			/>,
		);

		const title = await screen.findByText("README.md");
		fireEvent.contextMenu(title);

		expect(
			await screen.findByRole("menuitem", { name: "Preview" }),
		).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
	});

	it("opens the markdown preview modal when Preview is clicked in FileViewer", async () => {
		mockRead
			.mockResolvedValueOnce({
				path: "README.md",
				content: "# Hello",
				language: "markdown",
			})
			.mockReturnValue(new Promise(() => {})); // modal fetch never resolves

		render(
			<FileViewer
				worktreePath="/repo"
				relativePath="README.md"
				resolvedTheme="dark"
			/>,
		);

		const title = await screen.findByText("README.md");
		fireEvent.contextMenu(title);

		const previewItem = await screen.findByRole("menuitem", {
			name: "Preview",
		});
		fireEvent.click(previewItem);

		expect(await screen.findByText("Loading README.md…")).toBeInTheDocument();
	});

	it("closes preview modal when relativePath changes", async () => {
		mockRead
			.mockResolvedValueOnce({
				path: "README.md",
				content: "# Hello",
				language: "markdown",
			})
			.mockReturnValue(new Promise(() => {})); // modal fetch + subsequent viewer fetches never resolve

		const { rerender } = render(
			<FileViewer
				worktreePath="/repo"
				relativePath="README.md"
				resolvedTheme="dark"
			/>,
		);

		// Open the preview modal
		const title = await screen.findByText("README.md");
		fireEvent.contextMenu(title);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Preview" }));
		expect(await screen.findByText("Loading README.md…")).toBeInTheDocument();

		// Navigate to a different file — modal should close
		rerender(
			<FileViewer
				worktreePath="/repo"
				relativePath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);

		await waitFor(() => {
			expect(screen.queryByText("Loading README.md…")).not.toBeInTheDocument();
		});
	});
});
