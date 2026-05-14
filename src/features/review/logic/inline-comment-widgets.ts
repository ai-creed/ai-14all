import type { editor as MonacoEditor } from "monaco-editor";

export type StartDraftArg = {
	filePath: string;
	startLine: number;
	endLine: number;
	snippet: string;
};

export type SelectionPillController = {
	dispose: () => void;
	setSuppressed: (v: boolean) => void;
	simulateClick: () => void;
};

const WIDGET_ID = "shell-review-selection-pill";

export function installSelectionPill(
	editor: MonacoEditor.IStandaloneDiffEditor,
	filePath: string,
	onStart: (arg: StartDraftArg) => void,
): SelectionPillController {
	const modified = editor.getModifiedEditor();
	let suppressed = false;
	let lastRange: { startLine: number; endLine: number } | null = null;
	let mounted = false;

	const node = document.createElement("button");
	node.type = "button";
	node.className = "shell-review-selection-pill";
	node.textContent = "+ comment";
	node.addEventListener("click", () => emitStart());

	const widget: MonacoEditor.IContentWidget = {
		getId: () => WIDGET_ID,
		getDomNode: () => node,
		getPosition: () => {
			if (!lastRange) return null;
			return {
				position: { lineNumber: lastRange.endLine, column: 1 },
				preference: [1 /* EXACT */],
			};
		},
	};

	function show() {
		if (mounted || suppressed) return;
		modified.addContentWidget(widget);
		mounted = true;
	}
	function hide() {
		if (!mounted) return;
		modified.removeContentWidget(widget);
		mounted = false;
	}
	function emitStart() {
		if (!lastRange) return;
		const model = (modified as unknown as MonacoEditor.IStandaloneCodeEditor).getModel();
		const lines: string[] = [];
		if (model) {
			for (let l = lastRange.startLine; l <= lastRange.endLine; l++) {
				lines.push(model.getLineContent(l));
			}
		}
		onStart({
			filePath,
			startLine: lastRange.startLine,
			endLine: lastRange.endLine,
			snippet: lines.join("\n"),
		});
	}

	const sub = modified.onDidChangeCursorSelection((e) => {
		const sel = e.selection;
		if (!sel || sel.startLineNumber === sel.endLineNumber) {
			lastRange = null;
			hide();
			return;
		}
		lastRange = {
			startLine: Math.min(sel.startLineNumber, sel.endLineNumber),
			endLine: Math.max(sel.startLineNumber, sel.endLineNumber),
		};
		if (!suppressed) show();
	});

	return {
		dispose: () => {
			sub.dispose();
			hide();
		},
		setSuppressed: (v: boolean) => {
			suppressed = v;
			if (v) hide();
			else if (lastRange) show();
		},
		simulateClick: () => emitStart(),
	};
}
