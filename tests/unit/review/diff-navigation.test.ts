import { describe, it, expect, vi } from "vitest";
import type { editor as MonacoEditor } from "monaco-editor";
import {
	getDiffAnchorLines,
	getDiffModifiedHunkLines,
	navigateToNextDiff,
	navigateToPrevDiff,
} from "../../../src/features/review/logic/diff-navigation";

function makeEditor(opts: {
	changes: MonacoEditor.ILineChange[] | null;
	cursorLine?: number;
}) {
	const revealLineInCenter = vi.fn();
	const setPosition = vi.fn();
	const focus = vi.fn();
	const getPosition = vi.fn(() =>
		opts.cursorLine === undefined
			? null
			: { lineNumber: opts.cursorLine, column: 1 },
	);
	// scrollAncestorToLine short-circuits on null DOM, so this default is fine
	// for callers that don't care about outer-scroll behaviour.
	const getDomNode = vi.fn(() => null);
	const getScrolledVisiblePosition = vi.fn(() => null);
	const modified = {
		revealLineInCenter,
		setPosition,
		focus,
		getPosition,
		getDomNode,
		getScrolledVisiblePosition,
	};
	const editor = {
		getLineChanges: () => opts.changes,
		getModifiedEditor: () => modified,
	};
	return { editor, modified, revealLineInCenter, setPosition, focus };
}

function ch(
	modStart: number,
	modEnd: number,
	origStart = 1,
	origEnd = 1,
): MonacoEditor.ILineChange {
	return {
		modifiedStartLineNumber: modStart,
		modifiedEndLineNumber: modEnd,
		originalStartLineNumber: origStart,
		originalEndLineNumber: origEnd,
		charChanges: undefined,
	};
}

describe("getDiffAnchorLines", () => {
	it("returns empty when there are no changes", () => {
		const { editor } = makeEditor({ changes: null });
		expect(getDiffAnchorLines(editor)).toEqual([]);
	});

	it("uses modifiedStartLineNumber for normal changes", () => {
		const { editor } = makeEditor({
			changes: [ch(10, 12), ch(40, 40), ch(80, 90)],
		});
		expect(getDiffAnchorLines(editor)).toEqual([10, 40, 80]);
	});

	it("clamps deletion-only changes (modifiedEndLineNumber === 0) to >= 1", () => {
		const { editor } = makeEditor({
			changes: [ch(0, 0), ch(5, 0), ch(20, 25)],
		});
		expect(getDiffAnchorLines(editor)).toEqual([1, 5, 20]);
	});
});

describe("navigateToNextDiff", () => {
	it("returns false and does nothing when there are no changes", () => {
		const { editor, revealLineInCenter } = makeEditor({ changes: [] });
		expect(navigateToNextDiff(editor)).toBe(false);
		expect(revealLineInCenter).not.toHaveBeenCalled();
	});

	it("jumps to the first change after the cursor", () => {
		const { editor, revealLineInCenter, setPosition } = makeEditor({
			changes: [ch(10, 12), ch(40, 40), ch(80, 90)],
			cursorLine: 25,
		});
		expect(navigateToNextDiff(editor)).toBe(true);
		expect(revealLineInCenter).toHaveBeenCalledWith(40);
		expect(setPosition).toHaveBeenCalledWith({ lineNumber: 40, column: 1 });
	});

	it("wraps to the first change when cursor is past the last", () => {
		const { editor, revealLineInCenter } = makeEditor({
			changes: [ch(10, 12), ch(40, 40)],
			cursorLine: 100,
		});
		expect(navigateToNextDiff(editor)).toBe(true);
		expect(revealLineInCenter).toHaveBeenCalledWith(10);
	});

	it("treats null position as before-the-file (jumps to first change)", () => {
		const { editor, revealLineInCenter } = makeEditor({
			changes: [ch(10, 12), ch(40, 40)],
			cursorLine: undefined,
		});
		expect(navigateToNextDiff(editor)).toBe(true);
		expect(revealLineInCenter).toHaveBeenCalledWith(10);
	});
});

describe("navigateToPrevDiff", () => {
	it("returns false and does nothing when there are no changes", () => {
		const { editor, revealLineInCenter } = makeEditor({ changes: null });
		expect(navigateToPrevDiff(editor)).toBe(false);
		expect(revealLineInCenter).not.toHaveBeenCalled();
	});

	it("jumps to the largest change before the cursor", () => {
		const { editor, revealLineInCenter } = makeEditor({
			changes: [ch(10, 12), ch(40, 40), ch(80, 90)],
			cursorLine: 50,
		});
		expect(navigateToPrevDiff(editor)).toBe(true);
		expect(revealLineInCenter).toHaveBeenCalledWith(40);
	});

	it("wraps to the last change when cursor is at or before the first", () => {
		const { editor, revealLineInCenter } = makeEditor({
			changes: [ch(10, 12), ch(40, 40)],
			cursorLine: 5,
		});
		expect(navigateToPrevDiff(editor)).toBe(true);
		expect(revealLineInCenter).toHaveBeenCalledWith(40);
	});
});

describe("getDiffModifiedHunkLines", () => {
	it("returns Set([4,5,6,12,13]) for a fixture with two hunks (lines 4–6 and 12–13)", () => {
		const { editor } = makeEditor({
			changes: [ch(4, 6), ch(12, 13)],
		});
		expect(getDiffModifiedHunkLines(editor)).toEqual(new Set([4, 5, 6, 12, 13]));
	});

	it("returns no contribution for a pure-deletion hunk (modifiedEndLineNumber === 0)", () => {
		const { editor } = makeEditor({
			changes: [ch(5, 0), ch(20, 22)],
		});
		expect(getDiffModifiedHunkLines(editor)).toEqual(new Set([20, 21, 22]));
	});
});
