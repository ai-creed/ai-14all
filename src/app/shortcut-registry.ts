import type { Platform } from "./files-overlay-shortcut";
import {
	isFilesOverlayShortcut,
	detectPlatform,
} from "./files-overlay-shortcut";
import { targetOwnsTyping } from "./target-owns-typing";

export type { Platform };
export { detectPlatform };

/**
 * Pick the platform-appropriate label for an inline shortcut hint — UI
 * affordances NOT driven by SHORTCUT_REGISTRY (e.g. the editor save bar, the
 * layout-button tooltip). `⌘`-style on mac, `Ctrl`-style elsewhere, so Windows
 * never shows a Cmd hint for a Ctrl binding. Defaults to the detected platform;
 * pass `platform` explicitly in tests.
 */
export function shortcutHint(
	mac: string,
	other: string,
	platform: Platform = detectPlatform(),
): string {
	return platform === "mac" ? mac : other;
}

export interface AppShortcut {
	id: string;
	label: string;
	/** Platform display string shown in the shortcuts help overlay */
	mac: string;
	other: string;
	predicate(event: KeyboardEvent, platform: Platform): boolean;
}

function isNoteSheetShortcut(e: KeyboardEvent, platform: Platform): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== ";") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isReviewOpenShortcut(e: KeyboardEvent, platform: Platform): boolean {
	if (e.defaultPrevented) return false;
	const keyIsJ = e.key === "j" || e.key === "J";
	if (!keyIsJ) return false;
	if (e.altKey || e.shiftKey) return false;
	// allowXterm: Cmd+J (Open Review) is global navigation and must fire even when
	// focus is inside the terminal pane.
	if (targetOwnsTyping(e.target as HTMLElement | null, { allowXterm: true }))
		return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isRenameSessionShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	const keyIsR = e.key === "r" || e.key === "R";
	if (!keyIsR) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") {
		return e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
	}
	return e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey;
}

function isShortcutsHelpShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	// ⌘⇧P (VS Code-style command palette analogy) — mac only
	const keyIsShiftP =
		platform === "mac" &&
		(e.key === "p" || e.key === "P") &&
		e.shiftKey &&
		e.metaKey &&
		!e.ctrlKey &&
		!e.altKey;
	if (keyIsShiftP) {
		// allowXterm: global navigation shortcut — terminal binds no Cmd+Shift+P.
		return !targetOwnsTyping(e.target as HTMLElement | null, {
			allowXterm: true,
		});
	}
	// ⌘/ or ⌘? / Ctrl+/ or Ctrl+?
	const keyIsHelp = e.key === "?" || e.key === "/";
	if (!keyIsHelp) return false;
	// allowXterm: global navigation shortcut — terminal binds no Cmd+/ or Cmd+?.
	if (targetOwnsTyping(e.target as HTMLElement | null, { allowXterm: true }))
		return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey && !e.altKey;
	return e.ctrlKey && !e.metaKey && !e.altKey;
}

function isWorktreeSelectNextShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "]") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isWorktreeSelectPrevShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "[") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isWorktreeAddShortcut(e: KeyboardEvent, platform: Platform): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "n" && e.key !== "N") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

// Shift+] on US keyboard produces "}" as e.key
function isWorkspaceSelectNextShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "}") return false;
	if (e.altKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

// Shift+[ on US keyboard produces "{" as e.key
function isWorkspaceSelectPrevShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "{") return false;
	if (e.altKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isTerminalNewShortcut(e: KeyboardEvent, platform: Platform): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "t" && e.key !== "T") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null, { allowXterm: true }))
		return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

// ⌘⇧X / Ctrl+Shift+X — avoids macOS "Close All Windows" (⌘⇧W) system intercept
function isTerminalCloseShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "x" && e.key !== "X") return false;
	if (e.altKey || !e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null, { allowXterm: true }))
		return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isTerminalSelectNextShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "d" && e.key !== "D") return false;
	if (e.altKey || !e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null, { allowXterm: true }))
		return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isTerminalSelectPrevShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "a" && e.key !== "A") return false;
	if (e.altKey || !e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null, { allowXterm: true }))
		return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

// ⌘⇧L / Ctrl+Shift+L — opens the terminal layout dialog. Shift is required so
// the combo is not a control character the shell/PTY would consume; this mirrors
// the other terminal-management shortcuts and fires from inside the terminal.
function isTerminalLayoutShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "l" && e.key !== "L") return false;
	if (e.altKey || !e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null, { allowXterm: true }))
		return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isLayoutToggleSidebarShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "b" && e.key !== "B") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isReviewFilesShortcut(e: KeyboardEvent, platform: Platform): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "1") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isReviewChangesShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "2") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isReviewCommitsShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "3") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isOpenWorkspacePickerShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "o" && e.key !== "O") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isReviewFileNextShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	// Cmd/Ctrl+. (no Shift) — on US/most layouts e.key === "."
	if (e.key !== ".") return false;
	if (e.shiftKey || e.altKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isReviewFilePrevShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== ",") return false;
	if (e.shiftKey || e.altKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isReviewDiffNextShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	// Cmd/Ctrl+Shift+. — `e.key` is ">" on US layouts, "." on layouts that
	// don't apply Shift to the character. Accept either so non-US users still
	// get the shortcut.
	if (e.key !== ">" && e.key !== ".") return false;
	if (!e.shiftKey || e.altKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isReviewDiffPrevShortcut(
	e: KeyboardEvent,
	platform: Platform,
): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== "<" && e.key !== ",") return false;
	if (!e.shiftKey || e.altKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

export const SHORTCUT_REGISTRY: AppShortcut[] = [
	{
		id: "worktree.selectNext",
		label: "Next worktree",
		mac: "⌘]",
		other: "Ctrl+]",
		predicate: isWorktreeSelectNextShortcut,
	},
	{
		id: "worktree.selectPrev",
		label: "Previous worktree",
		mac: "⌘[",
		other: "Ctrl+[",
		predicate: isWorktreeSelectPrevShortcut,
	},
	{
		id: "worktree.add",
		label: "Add worktree",
		mac: "⌘N",
		other: "Ctrl+N",
		predicate: isWorktreeAddShortcut,
	},
	{
		id: "workspace.selectNext",
		label: "Next workspace",
		mac: "⌘⇧]",
		other: "Ctrl+Shift+]",
		predicate: isWorkspaceSelectNextShortcut,
	},
	{
		id: "workspace.selectPrev",
		label: "Previous workspace",
		mac: "⌘⇧[",
		other: "Ctrl+Shift+[",
		predicate: isWorkspaceSelectPrevShortcut,
	},
	{
		id: "ui.openWorkspacePicker",
		label: "Open workspace",
		mac: "⌘O",
		other: "Ctrl+O",
		predicate: isOpenWorkspacePickerShortcut,
	},
	{
		id: "terminal.new",
		label: "New terminal",
		mac: "⌘T",
		other: "Ctrl+T",
		predicate: isTerminalNewShortcut,
	},
	{
		id: "terminal.close",
		label: "Close terminal",
		mac: "⌘⇧X",
		other: "Ctrl+Shift+X",
		predicate: isTerminalCloseShortcut,
	},
	{
		id: "terminal.selectNext",
		label: "Next terminal",
		mac: "⌘⇧D",
		other: "Ctrl+Shift+D",
		predicate: isTerminalSelectNextShortcut,
	},
	{
		id: "terminal.selectPrev",
		label: "Previous terminal",
		mac: "⌘⇧A",
		other: "Ctrl+Shift+A",
		predicate: isTerminalSelectPrevShortcut,
	},
	{
		id: "terminal.layout",
		label: "Choose layout",
		mac: "⌘⇧L",
		other: "Ctrl+Shift+L",
		predicate: isTerminalLayoutShortcut,
	},
	{
		id: "layout.toggleSidebar",
		label: "Toggle sidebar",
		mac: "⌘B",
		other: "Ctrl+B",
		predicate: isLayoutToggleSidebarShortcut,
	},
	{
		id: "review.files",
		label: "Review: Files",
		mac: "⌘1",
		other: "Ctrl+1",
		predicate: isReviewFilesShortcut,
	},
	{
		id: "review.changes",
		label: "Review: Changes",
		mac: "⌘2",
		other: "Ctrl+2",
		predicate: isReviewChangesShortcut,
	},
	{
		id: "review.commits",
		label: "Review: Commits",
		mac: "⌘3",
		other: "Ctrl+3",
		predicate: isReviewCommitsShortcut,
	},
	{
		id: "review.fileNext",
		label: "Next file",
		mac: "⌘.",
		other: "Ctrl+.",
		predicate: isReviewFileNextShortcut,
	},
	{
		id: "review.filePrev",
		label: "Previous file",
		mac: "⌘,",
		other: "Ctrl+,",
		predicate: isReviewFilePrevShortcut,
	},
	{
		id: "review.diffNext",
		label: "Next diff in file",
		mac: "⌘⇧.",
		other: "Ctrl+Shift+.",
		predicate: isReviewDiffNextShortcut,
	},
	{
		id: "review.diffPrev",
		label: "Previous diff in file",
		mac: "⌘⇧,",
		other: "Ctrl+Shift+,",
		predicate: isReviewDiffPrevShortcut,
	},
	{
		id: "files-overlay",
		label: "Open Files",
		mac: "⌘P",
		other: "Ctrl+Shift+P",
		predicate: isFilesOverlayShortcut,
	},
	{
		id: "note-sheet",
		label: "Open Note",
		mac: "⌘;",
		other: "Ctrl+;",
		predicate: isNoteSheetShortcut,
	},
	{
		id: "review.open",
		label: "Open Review",
		mac: "⌘J",
		other: "Ctrl+J",
		predicate: isReviewOpenShortcut,
	},
	{
		id: "rename-session",
		label: "Rename session",
		mac: "⌘⇧R",
		other: "Ctrl+Alt+R",
		predicate: isRenameSessionShortcut,
	},
	{
		id: "shortcuts-help",
		label: "Show shortcuts",
		mac: "⌘⇧P or ⌘/",
		other: "Ctrl+/ or Ctrl+?",
		predicate: isShortcutsHelpShortcut,
	},
];
