import type { editor as MonacoEditor } from "monaco-editor";

// Minimal surface used by this module — exposed as a structural type so the
// helper can be unit-tested with a small mock instead of a full Monaco editor.
type DiffNavigableModifiedEditor = {
	revealLineInCenter(line: number): void;
	setPosition(position: { lineNumber: number; column: number }): void;
	getPosition(): { lineNumber: number; column: number } | null;
	getDomNode(): HTMLElement | null;
	getScrolledVisiblePosition(position: {
		lineNumber: number;
		column: number;
	}): { top: number; left: number; height: number } | null;
	focus(): void;
};

export type DiffNavigableEditor = {
	getLineChanges(): MonacoEditor.ILineChange[] | null;
	getModifiedEditor(): DiffNavigableModifiedEditor;
};

function anchorLineFor(change: MonacoEditor.ILineChange): number {
	// For pure deletions (modifiedEndLineNumber === 0) Monaco places the marker
	// between modified lines; modifiedStartLineNumber points to the line above.
	// Clamp to 1 so we never produce a non-positive line number.
	if (change.modifiedEndLineNumber > 0) return change.modifiedStartLineNumber;
	return Math.max(1, change.modifiedStartLineNumber);
}

export function getDiffAnchorLines(editor: DiffNavigableEditor): number[] {
	const changes = editor.getLineChanges();
	if (!changes || changes.length === 0) return [];
	return changes.map(anchorLineFor);
}

export function getDiffModifiedHunkLines(editor: DiffNavigableEditor): Set<number> {
	const changes = editor.getLineChanges();
	const set = new Set<number>();
	if (!changes) return set;
	for (const c of changes) {
		if (c.modifiedEndLineNumber <= 0) continue; // pure deletion
		for (let l = c.modifiedStartLineNumber; l <= c.modifiedEndLineNumber; l++) {
			set.add(l);
		}
	}
	return set;
}

function findScrollingAncestor(el: HTMLElement | null): HTMLElement | null {
	let cur: HTMLElement | null = el?.parentElement ?? null;
	while (cur) {
		const cs = window.getComputedStyle(cur);
		if (
			(cs.overflowY === "auto" || cs.overflowY === "scroll") &&
			cur.scrollHeight > cur.clientHeight
		) {
			return cur;
		}
		cur = cur.parentElement;
	}
	return null;
}

// In a stacked diff (CommitDiffStack with multiple files), each editor's height
// is set to its full content, so revealLineInCenter is a no-op — there's
// nothing to scroll within the editor. The user-visible scroll lives on a
// parent container. Walk up to that ancestor and center the target line in it.
function scrollAncestorToLine(
	modified: DiffNavigableModifiedEditor,
	line: number,
): void {
	const dom = modified.getDomNode();
	if (!dom) return;
	const pos = modified.getScrolledVisiblePosition({
		lineNumber: line,
		column: 1,
	});
	if (!pos) return;
	const ancestor = findScrollingAncestor(dom);
	if (!ancestor) return;
	const editorRect = dom.getBoundingClientRect();
	const ancestorRect = ancestor.getBoundingClientRect();
	const lineTop = editorRect.top + pos.top;
	const desiredTop =
		ancestorRect.top + ancestor.clientHeight / 2 - pos.height / 2;
	ancestor.scrollTop += lineTop - desiredTop;
}

function revealLine(editor: DiffNavigableEditor, line: number): void {
	const modified = editor.getModifiedEditor();
	// Handles the within-editor scroll case (DiffViewer / single-file commit).
	modified.revealLineInCenter(line);
	modified.setPosition({ lineNumber: line, column: 1 });
	// Handles the outer-scroll case (multi-file commit stack).
	scrollAncestorToLine(modified, line);
	modified.focus();
}

export function navigateToNextDiff(editor: DiffNavigableEditor): boolean {
	const lines = getDiffAnchorLines(editor);
	if (lines.length === 0) return false;
	const cursorLine = editor.getModifiedEditor().getPosition()?.lineNumber ?? 0;
	const target = lines.find((l) => l > cursorLine) ?? lines[0];
	revealLine(editor, target);
	return true;
}

export function navigateToPrevDiff(editor: DiffNavigableEditor): boolean {
	const lines = getDiffAnchorLines(editor);
	if (lines.length === 0) return false;
	const cursorLine =
		editor.getModifiedEditor().getPosition()?.lineNumber ??
		Number.MAX_SAFE_INTEGER;
	let target: number | undefined;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i] < cursorLine) {
			target = lines[i];
			break;
		}
	}
	if (target === undefined) target = lines[lines.length - 1];
	revealLine(editor, target);
	return true;
}
