import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fakeEditor = {
	getModifiedEditor: vi.fn(() => ({
		onMouseMove: vi.fn(),
		onMouseDown: vi.fn(),
		onDidChangeCursorSelection: vi.fn(),
		deltaDecorations: vi.fn(),
		revealLineInCenter: vi.fn(),
	})),
};

vi.mock("@monaco-editor/react", () => ({
	DiffEditor: (props: {
		original: string;
		modified: string;
		language?: string;
		theme?: string;
		options?: { fontSize?: number };
		onMount?: (editor: typeof fakeEditor) => void;
	}) => {
		props.onMount?.(fakeEditor);
		return (
			<div
				data-testid="diff-editor"
				data-language={props.language}
				data-theme={props.theme}
				data-font-size={String(props.options?.fontSize ?? "")}
			>
				<span data-testid="diff-editor-original">{props.original}</span>
				<span data-testid="diff-editor-modified">{props.modified}</span>
			</div>
		);
	},
}));

import { DiffViewer } from "../../../src/features/viewer/DiffViewer";

describe("DiffViewer", () => {
	it("renders side-by-side diff content in read-only mode", () => {
		render(
			<DiffViewer
				path="src/index.ts"
				content={
					'@@ -1 +1 @@\n-export const hello = "world";\n+export const hello = "phase-2";\n'
				}
				originalContent={'export const hello = "world";\n'}
				modifiedContent={'export const hello = "phase-2";\n'}
				resolvedTheme="dark"
			/>,
		);

		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(screen.getByTestId("diff-editor-original")).toHaveTextContent(
			'export const hello = "world";',
		);
		expect(screen.getByTestId("diff-editor-modified")).toHaveTextContent(
			'export const hello = "phase-2";',
		);
	});

	it("labels the diff as a HEAD comparison", () => {
		render(
			<DiffViewer
				path="src/index.ts"
				content="diff --git a/src/index.ts b/src/index.ts"
				originalContent=""
				modifiedContent=""
				resolvedTheme="dark"
			/>,
		);
		expect(screen.getByText("Diff vs HEAD")).toBeInTheDocument();
		expect(screen.getByTestId("diff-editor")).toHaveAttribute(
			"data-theme",
			"vs-dark",
		);
		expect(screen.getByTestId("diff-editor")).toHaveAttribute(
			"data-font-size",
			"12",
		);
	});

	it("calls onMount with filePath and editor instance when DiffEditor mounts", async () => {
		const onMount = vi.fn();
		render(
			<DiffViewer
				path="src/foo.ts"
				content=""
				originalContent="a"
				modifiedContent="b"
				resolvedTheme="light"
				onMount={onMount}
			/>,
		);
		expect(onMount).toHaveBeenCalledWith(
			"src/foo.ts",
			expect.objectContaining({ getModifiedEditor: expect.any(Function) }),
		);
	});
});
