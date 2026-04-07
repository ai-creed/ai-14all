import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		list: vi.fn(),
		listScoped: vi.fn(),
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

import { FileList } from "../../../src/features/viewer/FileList";
import { files } from "../../../src/lib/desktop-client";

const mockListScoped = vi.mocked(files.listScoped);

describe("FileList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders file paths from mock data", async () => {
		mockListScoped.mockResolvedValueOnce(["src/index.ts", "README.md"]);
		const onSelect = vi.fn();

		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={["src"]}
				selectedFile={null}
				onSelect={onSelect}
			/>,
		);

		// Wait for async fetch to resolve
		expect(
			await screen.findByRole("button", { name: "index.ts" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "README.md" }),
		).toBeInTheDocument();
	});

	it("highlights the selected file", async () => {
		mockListScoped.mockResolvedValueOnce(["src/index.ts", "README.md"]);

		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={["src"]}
				selectedFile="src/index.ts"
				onSelect={vi.fn()}
			/>,
		);

		// Wait for file list to render
		const selectedItem = await screen.findByRole("button", {
			name: "index.ts",
		});
		expect(selectedItem).toHaveAttribute("data-selected", "true");
	});

	it("calls onSelect when a file is clicked", async () => {
		mockListScoped.mockResolvedValueOnce(["src/index.ts", "README.md"]);
		const onSelect = vi.fn();

		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={["src"]}
				selectedFile={null}
				onSelect={onSelect}
			/>,
		);

		const fileItem = await screen.findByRole("button", { name: "README.md" });
		fireEvent.click(fileItem);
		expect(onSelect).toHaveBeenCalledWith("README.md");
	});

	it("shows loading state", () => {
		// Mock that never resolves
		mockListScoped.mockReturnValue(new Promise(() => {}));

		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={["src"]}
				selectedFile={null}
				onSelect={vi.fn()}
			/>,
		);

		expect(screen.getByText("Loading files…")).toBeInTheDocument();
	});

	it("renders folder groups for scoped files", async () => {
		mockListScoped.mockResolvedValue([
			"src/index.ts",
			"src/new-file.ts",
			"src/nested/example.ts",
		]);

		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={["src"]}
				selectedFile="src/index.ts"
				onSelect={() => {}}
			/>,
		);

		expect(await screen.findByText("src")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "index.ts" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "new-file.ts" }),
		).toBeInTheDocument();
	});

	it("shows empty state when scopeRoots is empty", async () => {
		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={[]}
				selectedFile={null}
				onSelect={() => {}}
			/>,
		);

		expect(
			await screen.findByText("No nearby files for changed directories."),
		).toBeInTheDocument();
		expect(
			screen.getByText("No nearby files for changed directories.").parentElement,
		).toHaveClass("shell-rail__message");
		expect(mockListScoped).not.toHaveBeenCalled();
	});

	it("shows error message when gitSummaryError is true", async () => {
		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={[]}
				selectedFile={null}
				onSelect={() => {}}
				gitSummaryError
			/>,
		);
		expect(
			await screen.findByText("Unable to load Git data."),
		).toBeInTheDocument();
		expect(
			screen.queryByText("No nearby files for changed directories."),
		).not.toBeInTheDocument();
	});

	it("shows context menu with Preview item when a .md file is right-clicked", async () => {
		mockListScoped.mockResolvedValueOnce(["README.md", "src/index.ts"]);
		vi.mocked(files.read).mockReturnValue(new Promise(() => {}));

		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={["."]}
				selectedFile={null}
				onSelect={vi.fn()}
			/>,
		);

		const mdFile = await screen.findByRole("button", { name: "README.md" });
		fireEvent.contextMenu(mdFile);

		expect(
			await screen.findByRole("menuitem", { name: "Preview" }),
		).toBeInTheDocument();
	});

	it("does not show a context menu when a non-.md file is right-clicked", async () => {
		mockListScoped.mockResolvedValueOnce(["src/index.ts"]);

		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={["src"]}
				selectedFile={null}
				onSelect={vi.fn()}
			/>,
		);

		const tsFile = await screen.findByRole("button", { name: "index.ts" });
		fireEvent.contextMenu(tsFile);

		expect(
			screen.queryByRole("menuitem", { name: "Preview" }),
		).not.toBeInTheDocument();
	});

	it("opens the markdown preview modal when Preview is clicked", async () => {
		mockListScoped.mockResolvedValueOnce(["README.md"]);
		vi.mocked(files.read).mockReturnValue(new Promise(() => {}));

		render(
			<FileList
				worktreePath="/repo"
				scopeRoots={["."]}
				selectedFile={null}
				onSelect={vi.fn()}
			/>,
		);

		const mdFile = await screen.findByRole("button", { name: "README.md" });
		fireEvent.contextMenu(mdFile);

		const previewItem = await screen.findByRole("menuitem", { name: "Preview" });
		fireEvent.click(previewItem);

		expect(
			await screen.findByText("Loading README.md…"),
		).toBeInTheDocument();
	});

	it("closes the preview modal when worktreePath changes", async () => {
		mockListScoped.mockResolvedValue(["README.md"]);
		vi.mocked(files.read).mockReturnValue(new Promise(() => {}));

		const { rerender } = render(
			<FileList
				worktreePath="/repo"
				scopeRoots={["."]}
				selectedFile={null}
				onSelect={vi.fn()}
			/>,
		);

		// Open the preview
		const mdFile = await screen.findByRole("button", { name: "README.md" });
		fireEvent.contextMenu(mdFile);
		const previewItem = await screen.findByRole("menuitem", { name: "Preview" });
		fireEvent.click(previewItem);
		await screen.findByText("Loading README.md…");

		// Simulate worktree change
		rerender(
			<FileList
				worktreePath="/repo2"
				scopeRoots={["."]}
				selectedFile={null}
				onSelect={vi.fn()}
			/>,
		);

		// Modal should be gone
		await waitFor(() => {
			expect(screen.queryByText(/Loading README\.md/)).not.toBeInTheDocument();
		});
	});
});
