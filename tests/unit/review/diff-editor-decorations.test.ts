import { describe, it, expect, vi } from "vitest";
import type { editor as MonacoEditor } from "monaco-editor";
import {
	installAddAffordances,
	scrollToLineRange,
	PLUS_DECORATION_CLASS,
} from "../../../src/features/review/logic/diff-editor-decorations";

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
		onMouseLeave: vi.fn().mockReturnValue({ dispose: vi.fn() }),
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
		getLineChanges: vi.fn().mockReturnValue([]),
		onDidUpdateDiff: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	};
	return {
		modified,
		editor,
		typedEditor: editor as unknown as MonacoEditor.IStandaloneDiffEditor,
	};
}

// Extended fake for hover + hunk-gating tests
function fakeEditorWithHunks(opts: { lineCount?: number; hunkLines?: number[] } = {}) {
	const lineCount = opts.lineCount ?? 10;
	const hunkLineSet = new Set(opts.hunkLines ?? []);

	// Build ILineChange[] from hunkLines: collapse consecutive lines into runs
	const sortedHunkLines = [...hunkLineSet].sort((a, b) => a - b);
	const lineChanges: Array<{
		modifiedStartLineNumber: number;
		modifiedEndLineNumber: number;
		originalStartLineNumber: number;
		originalEndLineNumber: number;
	}> = [];
	let runStart: number | null = null;
	let runEnd: number | null = null;
	for (const l of sortedHunkLines) {
		if (runStart === null) {
			runStart = l;
			runEnd = l;
		} else if (l === (runEnd as number) + 1) {
			runEnd = l;
		} else {
			lineChanges.push({ modifiedStartLineNumber: runStart, modifiedEndLineNumber: runEnd as number, originalStartLineNumber: runStart, originalEndLineNumber: runEnd as number });
			runStart = l;
			runEnd = l;
		}
	}
	if (runStart !== null) {
		lineChanges.push({ modifiedStartLineNumber: runStart, modifiedEndLineNumber: runEnd as number, originalStartLineNumber: runStart, originalEndLineNumber: runEnd as number });
	}

	// Live decoration tracking
	let currentDecorations: Array<{ range: { startLineNumber: number }; options: { glyphMarginClassName: string } }> = [];

	const moveHandlers: MouseHandler[] = [];
	const leaveHandlers: Array<() => void> = [];

	const modified = {
		onMouseMove: vi.fn((h: MouseHandler) => { moveHandlers.push(h); return { dispose: vi.fn() }; }),
		onMouseLeave: vi.fn((h: () => void) => { leaveHandlers.push(h); return { dispose: vi.fn() }; }),
		onMouseDown: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidChangeCursorSelection: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidChangeModel: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		deltaDecorations: vi.fn((_old: string[], next: Array<{ range: { startLineNumber: number }; options: { glyphMarginClassName: string } }>) => {
			currentDecorations = next;
			return next.map((_, i) => String(i));
		}),
		revealLineInCenter: vi.fn(),
		getModel: vi.fn().mockReturnValue({
			getLineCount: () => lineCount,
			getLineContent: () => "",
		}),
	};

	const editor = {
		getModifiedEditor: () => modified,
		onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		getLineChanges: () => lineChanges as MonacoEditor.ILineChange[],
		onDidUpdateDiff: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	};

	return {
		editor: editor as unknown as MonacoEditor.IStandaloneDiffEditor,
		emitMouseMove: (line: number) => {
			for (const h of moveHandlers) h({ target: { position: { lineNumber: line } } });
		},
		emitMouseLeave: () => {
			for (const h of leaveHandlers) h();
		},
		glyphLines: () =>
			currentDecorations
				.filter((d) => d.options.glyphMarginClassName === PLUS_DECORATION_CLASS)
				.map((d) => d.range.startLineNumber),
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

describe("installAddAffordances — hover + hunk gating", () => {
	it("renders no plus glyph initially (no hover)", () => {
		const ed = fakeEditorWithHunks();
		installAddAffordances(ed.editor, {
			filePath: "a.ts",
			onAddSingleLine: () => {},
			onSelectionChange: () => {},
		});
		expect(ed.glyphLines()).toEqual([]);
	});

	it("renders the glyph only on the hovered line and only inside a hunk", () => {
		const ed = fakeEditorWithHunks({
			lineCount: 20,
			hunkLines: [3, 4, 5, 12, 13],
		});
		installAddAffordances(ed.editor, {
			filePath: "a.ts",
			onAddSingleLine: () => {},
			onSelectionChange: () => {},
		});
		ed.emitMouseMove(4);
		expect(ed.glyphLines()).toEqual([4]);
		ed.emitMouseMove(8); // outside any hunk
		expect(ed.glyphLines()).toEqual([]);
		ed.emitMouseMove(12);
		expect(ed.glyphLines()).toEqual([12]);
	});

	it("clears the glyph when the mouse leaves the editor", () => {
		const ed = fakeEditorWithHunks({ hunkLines: [4] });
		installAddAffordances(ed.editor, {
			filePath: "a.ts",
			onAddSingleLine: () => {},
			onSelectionChange: () => {},
		});
		ed.emitMouseMove(4);
		expect(ed.glyphLines()).toEqual([4]);
		ed.emitMouseLeave();
		expect(ed.glyphLines()).toEqual([]);
	});
});
