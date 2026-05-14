import type { editor as MonacoEditor } from "monaco-editor";
import { getDiffModifiedHunkLines } from "./diff-navigation";

export type SelectionDraft = {
	filePath: string;
	startLine: number;
	endLine: number;
	snippet: string;
} | null;

type Handlers = {
	filePath: string;
	onAddSingleLine: (info: {
		filePath: string;
		line: number;
		snippet: string;
	}) => void;
	onSelectionChange: (draft: SelectionDraft) => void;
	onEnsureFileFocused?: (filePath: string) => void;
};

export const PLUS_DECORATION_CLASS = "shell-review-plus-decoration";

export function installAddAffordances(
	editor: MonacoEditor.IStandaloneDiffEditor,
	handlers: Handlers,
): () => void {
	const modified = editor.getModifiedEditor();
	let plusDecorations: string[] = [];
	let hoveredLine: number | null = null;
	let hunkLines: Set<number> = new Set();

	const recomputeHunkLines = () => {
		hunkLines = getDiffModifiedHunkLines(editor);
		applyGlyph();
	};

	const applyGlyph = () => {
		const next =
			hoveredLine !== null && hunkLines.has(hoveredLine)
				? [
						{
							range: {
								startLineNumber: hoveredLine,
								startColumn: 1,
								endLineNumber: hoveredLine,
								endColumn: 1,
							},
							options: {
								glyphMarginClassName: PLUS_DECORATION_CLASS,
								glyphMarginHoverMessage: { value: "Add review comment" },
							},
						},
					]
				: [];
		plusDecorations = (
			modified as unknown as MonacoEditor.IStandaloneCodeEditor
		).deltaDecorations(plusDecorations, next);
	};

	recomputeHunkLines();

	const diffSub = (editor as unknown as { onDidUpdateDiff?: (cb: () => void) => { dispose(): void } }).onDidUpdateDiff?.(() => recomputeHunkLines()) ?? { dispose: () => {} };
	const modelSub = (
		modified as unknown as MonacoEditor.IStandaloneCodeEditor
	).onDidChangeModel(() => recomputeHunkLines());

	const moveSub = modified.onMouseMove((e) => {
		const next = e.target?.position?.lineNumber ?? null;
		if (next === hoveredLine) return;
		hoveredLine = next;
		applyGlyph();
	});

	const leaveSub = modified.onMouseLeave(() => {
		if (hoveredLine === null) return;
		hoveredLine = null;
		applyGlyph();
	});

	const downSub = modified.onMouseDown((e) => {
		const targetClass: string | undefined = e.target?.element?.className;
		if (
			targetClass &&
			targetClass.includes(PLUS_DECORATION_CLASS) &&
			hoveredLine !== null
		) {
			const line = hoveredLine;
			const text =
				(modified as unknown as MonacoEditor.IStandaloneCodeEditor)
					.getModel()
					?.getLineContent(line) ?? "";
			handlers.onEnsureFileFocused?.(handlers.filePath);
			handlers.onAddSingleLine({
				filePath: handlers.filePath,
				line,
				snippet: text,
			});
		}
	});

	const selSub = modified.onDidChangeCursorSelection((e) => {
		const sel = e.selection;
		if (!sel || sel.startLineNumber === sel.endLineNumber) {
			handlers.onSelectionChange(null);
			return;
		}
		const startLine = Math.min(sel.startLineNumber, sel.endLineNumber);
		const endLine = Math.max(sel.startLineNumber, sel.endLineNumber);
		const model = (
			modified as unknown as MonacoEditor.IStandaloneCodeEditor
		).getModel();
		if (!model) {
			handlers.onSelectionChange(null);
			return;
		}
		const lines: string[] = [];
		for (let l = startLine; l <= endLine; l++)
			lines.push(model.getLineContent(l));
		handlers.onSelectionChange({
			filePath: handlers.filePath,
			startLine,
			endLine,
			snippet: lines.join("\n"),
		});
	});

	return () => {
		diffSub.dispose();
		modelSub.dispose();
		moveSub.dispose();
		leaveSub.dispose();
		downSub.dispose();
		selSub.dispose();
		plusDecorations = (
			modified as unknown as MonacoEditor.IStandaloneCodeEditor
		).deltaDecorations(plusDecorations, []);
	};
}

export function scrollToLineRange(
	editor: MonacoEditor.IStandaloneDiffEditor,
	range: { startLine: number; endLine: number },
): void {
	const modified = editor.getModifiedEditor();
	modified.revealLineInCenter(range.startLine);
}
