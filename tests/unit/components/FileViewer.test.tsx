import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

		render(<FileViewer worktreePath="/repo" relativePath="src/index.ts" />);

		// Wait for async fetch to resolve and editor to render
		const editor = await screen.findByTestId("monaco-editor");
		expect(editor).toHaveTextContent('export const hello = "world";');
		expect(editor).toHaveAttribute("data-language", "typescript");
		expect(editor).toHaveAttribute("data-theme", "vs-dark");
		expect(editor).toHaveAttribute("data-readonly", "true");
		expect(editor).toHaveAttribute("data-font-size", "11");
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
			<FileViewer worktreePath="/repo" relativePath="src/index.ts" />,
		);
		await screen.findByText("src/index.ts");

		// Change worktreePath to trigger a re-fetch for the same relativePath.
		// The second mock call fails while relativePath still matches the cached
		// fileView.path, so the component should preserve the content and show
		// the stale message rather than clearing the view.
		rerender(<FileViewer worktreePath="/repo2" relativePath="src/index.ts" />);

		await waitFor(() => {
			expect(screen.getByText(/showing last successful result/i)).toBeInTheDocument();
		});
	});
});
