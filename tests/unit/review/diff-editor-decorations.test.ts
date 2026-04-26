import { describe, it, expect, vi } from "vitest";
import {
	installAddAffordances,
	scrollToLineRange,
} from "../../../src/features/review/diff-editor-decorations";

function fakeModified(lineCount = 3) {
	return {
		onMouseMove: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onMouseDown: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidChangeCursorSelection: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		deltaDecorations: vi.fn().mockReturnValue([]),
		revealLineInCenter: vi.fn(),
		getModel: vi.fn().mockReturnValue({ getLineCount: () => lineCount, getLineContent: () => "" }),
	};
}

function fakeEditor() {
	const modified = fakeModified();
	return {
		modified,
		editor: {
			getModifiedEditor: () => modified,
			onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		},
	};
}

describe("diff-editor-decorations", () => {
	it("registers mouse + selection listeners and returns a disposer", () => {
		const { editor, modified } = fakeEditor();
		const dispose = installAddAffordances(editor as any, {
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
		const { editor, modified } = fakeEditor();
		const order: string[] = [];
		const ensure = vi.fn(() => order.push("focus"));
		const add = vi.fn(() => order.push("add"));
		let mouseDownHandler:
			| ((e: { target: { element: { className: string } } }) => void)
			| null = null;
		modified.onMouseDown.mockImplementation((h: any) => {
			mouseDownHandler = h;
			return { dispose: vi.fn() };
		});
		let moveHandler:
			| ((e: { target: { position: { lineNumber: number } } }) => void)
			| null = null;
		modified.onMouseMove.mockImplementation((h: any) => {
			moveHandler = h;
			return { dispose: vi.fn() };
		});
		modified.deltaDecorations.mockReturnValue([]);
		(modified as any).getModel = () => ({
			getLineCount: () => 5,
			getLineContent: () => "const x = 1;",
		});
		installAddAffordances(editor as any, {
			filePath: "src/foo.ts",
			onAddSingleLine: add,
			onSelectionChange: vi.fn(),
			onEnsureFileFocused: ensure,
		});
		moveHandler?.({ target: { position: { lineNumber: 5 } } });
		mouseDownHandler?.({
			target: { element: { className: "shell-review-plus-decoration" } },
		});
		expect(order).toEqual(["focus", "add"]);
	});

	it("onSelectionChange fires with draft on multi-line selection and null on collapse", () => {
		const { editor, modified } = fakeEditor();
		let selHandler:
			| ((e: {
					selection: { startLineNumber: number; endLineNumber: number };
				}) => void)
			| null = null;
		modified.onDidChangeCursorSelection.mockImplementation((h: any) => {
			selHandler = h;
			return { dispose: vi.fn() };
		});
		(modified as any).getModel = () => ({
			getLineCount: () => 5,
			getLineContent: (l: number) => `line ${l}`,
		});
		const onSelectionChange = vi.fn();
		installAddAffordances(editor as any, {
			filePath: "src/foo.ts",
			onAddSingleLine: vi.fn(),
			onSelectionChange,
			onEnsureFileFocused: vi.fn(),
		});
		selHandler?.({ selection: { startLineNumber: 3, endLineNumber: 5 } });
		expect(onSelectionChange).toHaveBeenCalledWith({
			filePath: "src/foo.ts",
			startLine: 3,
			endLine: 5,
			snippet: "line 3\nline 4\nline 5",
		});
		selHandler?.({ selection: { startLineNumber: 5, endLineNumber: 5 } });
		expect(onSelectionChange).toHaveBeenLastCalledWith(null);
	});

	it("scrollToLineRange calls revealLineInCenter on the modified pane", () => {
		const { editor, modified } = fakeEditor();
		scrollToLineRange(editor as any, { startLine: 12, endLine: 18 });
		expect(modified.revealLineInCenter).toHaveBeenCalledWith(12);
	});
});
