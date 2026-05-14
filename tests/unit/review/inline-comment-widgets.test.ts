import { describe, expect, it, vi } from "vitest";
import { installSelectionPill } from "../../../src/features/review/logic/inline-comment-widgets";
import type { editor as MonacoEditor } from "monaco-editor";

function fakeEditor() {
	const widgets: Array<{ id: string }> = [];
	const subs: Array<(e: { selection: { startLineNumber: number; endLineNumber: number } | null }) => void> = [];
	const modified = {
		addContentWidget: (w: MonacoEditor.IContentWidget) => widgets.push({ id: w.getId() }),
		removeContentWidget: (w: MonacoEditor.IContentWidget) => {
			const i = widgets.findIndex((x) => x.id === w.getId());
			if (i >= 0) widgets.splice(i, 1);
		},
		layoutContentWidget: () => {},
		onDidChangeCursorSelection: (cb: (e: { selection: { startLineNumber: number; endLineNumber: number } | null }) => void) => {
			subs.push(cb);
			return { dispose() {} };
		},
		getModel: () => ({ getLineContent: (n: number) => `line ${n}` }),
	};
	const editor = {
		getModifiedEditor: () => modified,
	} as unknown as MonacoEditor.IStandaloneDiffEditor;
	function emitSelection(start: number, end: number) {
		for (const s of subs) s({ selection: { startLineNumber: start, endLineNumber: end } });
	}
	function emitNoSelection() {
		for (const s of subs) s({ selection: null });
	}
	return { editor, widgets, emitSelection, emitNoSelection };
}

describe("installSelectionPill", () => {
	it("shows pill on multi-line selection and hides on collapse", () => {
		const { editor, widgets, emitSelection, emitNoSelection } = fakeEditor();
		const onStart = vi.fn();
		installSelectionPill(editor, "a.ts", onStart);
		expect(widgets).toHaveLength(0);
		emitSelection(3, 5);
		expect(widgets).toHaveLength(1);
		emitNoSelection();
		expect(widgets).toHaveLength(0);
	});

	it("clicking the pill calls onStart with the selected range and snippet", () => {
		const { editor, emitSelection } = fakeEditor();
		const onStart = vi.fn();
		const { simulateClick } = installSelectionPill(editor, "a.ts", onStart);
		emitSelection(3, 5);
		simulateClick();
		expect(onStart).toHaveBeenCalledWith({
			filePath: "a.ts",
			startLine: 3,
			endLine: 5,
			snippet: "line 3\nline 4\nline 5",
		});
	});

	it("hides the pill while a draft is open (suppress flag)", () => {
		const { editor, widgets, emitSelection } = fakeEditor();
		const ctrl = installSelectionPill(editor, "a.ts", () => {});
		ctrl.setSuppressed(true);
		emitSelection(3, 5);
		expect(widgets).toHaveLength(0);
	});
});
