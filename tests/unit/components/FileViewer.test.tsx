import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
		options?: { readOnly?: boolean };
	}) => (
		<div
			data-testid="monaco-editor"
			data-language={props.language}
			data-readonly={String(props.options?.readOnly ?? false)}
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

		render(<FileViewer worktreePath="/repo" relativePath="src/index.ts" />);

		// Wait for async fetch to resolve and editor to render
		const editor = await screen.findByTestId("monaco-editor");
		expect(editor).toHaveTextContent('export const hello = "world";');
		expect(editor).toHaveAttribute("data-language", "typescript");
		expect(editor).toHaveAttribute("data-readonly", "true");
	});

	it("shows file path header", async () => {
		mockRead.mockResolvedValueOnce(fakeFileView);

		render(<FileViewer worktreePath="/repo" relativePath="src/index.ts" />);

		expect(await screen.findByText("src/index.ts")).toBeInTheDocument();
	});

	it("shows loading state while fetching", () => {
		mockRead.mockReturnValue(new Promise(() => {}));

		render(<FileViewer worktreePath="/repo" relativePath="src/index.ts" />);

		expect(screen.getByText("Loading src/index.ts…")).toBeInTheDocument();
	});

	it("shows error when fetch fails", async () => {
		mockRead.mockRejectedValueOnce(new Error("File not found"));

		render(<FileViewer worktreePath="/repo" relativePath="missing.ts" />);

		expect(
			await screen.findByText("Error: File not found"),
		).toBeInTheDocument();
	});
});
