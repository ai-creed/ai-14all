import { describe, it, expect, vi } from "vitest";
import type { editor as MonacoEditor } from "monaco-editor";
import {
	installAddAffordances,
	scrollToLineRange,
} from "../../../src/features/review/diff-editor-decorations";

type MouseHandler = (e: {
	target: {
		element?: { className: string };
		position?: { lineNumber: number };
	};
}) => void;
type SelectionHandler = (e: {
	selection: { startLineNumber: number; endLineNumber: number };
}) => void;

function fakeModified(lineCount = 3) {
	return {
		onMouseMove: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onMouseDown: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidChangeCursorSelection: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidChangeModel: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		deltaDecorations: vi.fn().mockReturnValue([]),
		revealLineInCenter: vi.fn(),
		getModel: vi.fn().mockReturnValue({
			getLineCount: () => lineCount,
			getLineContent: () => "",
		}),
	};
}

function fakeEditor() {
	const modified = fakeModified();
	const editor = {
		getModifiedEditor: () => modified,
		onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	};
	return {
		modified,
		editor,
		typedEditor: editor as unknown as MonacoEditor.IStandaloneDiffEditor,
	};
}

describe("diff-editor-decorations", () => {
	it("registers mouse + selection listeners and returns a disposer", () => {
		const { typedEditor, modified } = fakeEditor();
		const dispose = installAddAffordances(typedEditor, {
			filePath: "src/foo.ts",
			onAddSingleLine: vi.fn(),
			onSelectionChange: vi.fn(),
			onEnsureFileFocused: vi.fn(),
		});
		expect(modified.onMouseMove).toHaveBeenCalled();
		expect(modified.onMouseDown).toHaveBeenCalled();
		expect(modified.onDidChangeCursorSelection).toHaveBeenCalled();
		dispose();
	});

	it("onEnsureFileFocused is called before onAddSingleLine when gutter + clicked", () => {
		const { typedEditor, modified } = fakeEditor();
		const order: string[] = [];
		const ensure = vi.fn(() => order.push("focus"));
		const add = vi.fn(() => order.push("add"));
		let mouseDownHandler: MouseHandler | null = null;
		modified.onMouseDown.mockImplementation((h: MouseHandler) => {
			mouseDownHandler = h;
			return { dispose: vi.fn() };
		});
		let moveHandler: MouseHandler | null = null;
		modified.onMouseMove.mockImplementation((h: MouseHandler) => {
			moveHandler = h;
			return { dispose: vi.fn() };
		});
		modified.deltaDecorations.mockReturnValue([]);
		modified.getModel.mockReturnValue({
			getLineCount: () => 5,
			getLineContent: () => "const x = 1;",
		});
		installAddAffordances(typedEditor, {
			filePath: "src/foo.ts",
			onAddSingleLine: add,
			onSelectionChange: vi.fn(),
			onEnsureFileFocused: ensure,
		});
		// biome-ignore lint/style/noNonNullAssertion: mockImplementation runs synchronously, so handlers are set
		moveHandler!({ target: { position: { lineNumber: 5 } } });
		// biome-ignore lint/style/noNonNullAssertion: mockImplementation runs synchronously, so handlers are set
		mouseDownHandler!({
			target: { element: { className: "shell-review-plus-decoration" } },
		});
		expect(order).toEqual(["focus", "add"]);
	});

	it("onSelectionChange fires with draft on multi-line selection and null on collapse", () => {
		const { typedEditor, modified } = fakeEditor();
		let selHandler: SelectionHandler | null = null;
		modified.onDidChangeCursorSelection.mockImplementation(
			(h: SelectionHandler) => {
				selHandler = h;
				return { dispose: vi.fn() };
			},
		);
		modified.getModel.mockReturnValue({
			getLineCount: () => 5,
			getLineContent: (l: number) => `line ${l}`,
		});
		const onSelectionChange = vi.fn();
		installAddAffordances(typedEditor, {
			filePath: "src/foo.ts",
			onAddSingleLine: vi.fn(),
			onSelectionChange,
			onEnsureFileFocused: vi.fn(),
		});
		// biome-ignore lint/style/noNonNullAssertion: mockImplementation runs synchronously, so handlers are set
		selHandler!({ selection: { startLineNumber: 3, endLineNumber: 5 } });
		expect(onSelectionChange).toHaveBeenCalledWith({
			filePath: "src/foo.ts",
			startLine: 3,
			endLine: 5,
			snippet: "line 3\nline 4\nline 5",
		});
		// biome-ignore lint/style/noNonNullAssertion: mockImplementation runs synchronously, so handlers are set
		selHandler!({ selection: { startLineNumber: 5, endLineNumber: 5 } });
		expect(onSelectionChange).toHaveBeenLastCalledWith(null);
	});

	it("scrollToLineRange calls revealLineInCenter on the modified pane", () => {
		const { typedEditor, modified } = fakeEditor();
		scrollToLineRange(typedEditor, { startLine: 12, endLine: 18 });
		expect(modified.revealLineInCenter).toHaveBeenCalledWith(12);
	});
});
