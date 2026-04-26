import type { editor as MonacoEditor } from "monaco-editor";

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

const PLUS_DECORATION_CLASS = "shell-review-plus-decoration";

export function installAddAffordances(
	editor: MonacoEditor.IStandaloneDiffEditor,
	handlers: Handlers,
): () => void {
	const modified = editor.getModifiedEditor();
	let plusDecorations: string[] = [];
	let hoveredLine: number | null = null;

	const renderAllPlus = () => {
		const model = (modified as unknown as MonacoEditor.IStandaloneCodeEditor).getModel();
		const lineCount = model?.getLineCount() ?? 0;
		const next = Array.from({ length: lineCount }, (_, i) => ({
			range: {
				startLineNumber: i + 1,
				startColumn: 1,
				endLineNumber: i + 1,
				endColumn: 1,
			},
			options: {
				glyphMarginClassName: PLUS_DECORATION_CLASS,
				glyphMarginHoverMessage: { value: "Add review comment" },
			},
		}));
		plusDecorations = (modified as unknown as MonacoEditor.IStandaloneCodeEditor).deltaDecorations(
			plusDecorations,
			next,
		);
	};

	renderAllPlus();

	const modelSub = (modified as unknown as MonacoEditor.IStandaloneCodeEditor).onDidChangeModel(
		() => renderAllPlus(),
	);

	const moveSub = modified.onMouseMove((e) => {
		hoveredLine = e.target?.position?.lineNumber ?? null;
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
		for (let l = startLine; l <= endLine; l++) lines.push(model.getLineContent(l));
		handlers.onSelectionChange({
			filePath: handlers.filePath,
			startLine,
			endLine,
			snippet: lines.join("\n"),
		});
	});

	return () => {
		modelSub.dispose();
		moveSub.dispose();
		downSub.dispose();
		selSub.dispose();
		plusDecorations = (modified as unknown as MonacoEditor.IStandaloneCodeEditor).deltaDecorations(
			plusDecorations,
			[],
		);
	};
}

export function scrollToLineRange(
	editor: MonacoEditor.IStandaloneDiffEditor,
	range: { startLine: number; endLine: number },
): void {
	const modified = editor.getModifiedEditor();
	modified.revealLineInCenter(range.startLine);
}
