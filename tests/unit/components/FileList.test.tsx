import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		list: vi.fn(),
	},
}));

import { FileList } from "../../../src/features/viewer/FileList";
import { files } from "../../../src/lib/desktop-client";

const mockList = vi.mocked(files.list);

describe("FileList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders file paths from mock data", async () => {
		mockList.mockResolvedValueOnce(["src/index.ts", "README.md"]);
		const onSelect = vi.fn();

		render(
			<FileList worktreePath="/repo" selectedFile={null} onSelect={onSelect} />,
		);

		// Wait for async fetch to resolve
		expect(
			await screen.findByRole("button", { name: "src/index.ts" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "README.md" })).toBeInTheDocument();
	});

	it("highlights the selected file", async () => {
		mockList.mockResolvedValueOnce(["src/index.ts", "README.md"]);

		render(
			<FileList
				worktreePath="/repo"
				selectedFile="src/index.ts"
				onSelect={vi.fn()}
			/>,
		);

		// Wait for file list to render
		const selectedItem = await screen.findByRole("button", {
			name: "src/index.ts",
		});
		expect(selectedItem).toHaveAttribute("data-selected", "true");
	});

	it("calls onSelect when a file is clicked", async () => {
		mockList.mockResolvedValueOnce(["src/index.ts", "README.md"]);
		const onSelect = vi.fn();

		render(
			<FileList worktreePath="/repo" selectedFile={null} onSelect={onSelect} />,
		);

		const fileItem = await screen.findByRole("button", { name: "README.md" });
		fireEvent.click(fileItem);
		expect(onSelect).toHaveBeenCalledWith("README.md");
	});

	it("shows loading state", () => {
		// Mock that never resolves
		mockList.mockReturnValue(new Promise(() => {}));

		render(
			<FileList worktreePath="/repo" selectedFile={null} onSelect={vi.fn()} />,
		);

		expect(screen.getByText("Loading files…")).toBeInTheDocument();
	});
});
