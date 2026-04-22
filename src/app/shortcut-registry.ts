import type { Platform } from "./files-overlay-shortcut";
import { isFilesOverlayShortcut, detectPlatform } from "./files-overlay-shortcut";

export type { Platform };
export { detectPlatform };

export interface AppShortcut {
	id: string;
	label: string;
	/** Platform display string shown in the shortcuts help overlay */
	mac: string;
	other: string;
	predicate(event: KeyboardEvent, platform: Platform): boolean;
}

function targetOwnsTyping(target: HTMLElement | null): boolean {
	if (!target || typeof target.closest !== "function") return false;
	if (target.closest(".xterm")) return true;
	if (target.closest('[role="dialog"]')) return true;
	if (target.closest(".monaco-editor")) return true;
	if (target.closest('[contenteditable="true"]')) return true;
	if (target.closest('[role="textbox"]')) return true;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	return false;
}

function isNoteSheetShortcut(e: KeyboardEvent, platform: Platform): boolean {
	if (e.defaultPrevented) return false;
	if (e.key !== ";") return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isReviewDrawerShortcut(e: KeyboardEvent, platform: Platform): boolean {
	if (e.defaultPrevented) return false;
	const keyIsJ = e.key === "j" || e.key === "J";
	if (!keyIsJ) return false;
	if (e.altKey || e.shiftKey) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey;
	return e.ctrlKey && !e.metaKey;
}

function isRenameSessionShortcut(e: KeyboardEvent, platform: Platform): boolean {
	if (e.defaultPrevented) return false;
	const keyIsR = e.key === "r" || e.key === "R";
	if (!keyIsR) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") {
		return e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
	}
	return e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey;
}

function isShortcutsHelpShortcut(e: KeyboardEvent, platform: Platform): boolean {
	if (e.defaultPrevented) return false;
	const keyIsHelp = e.key === "?" || e.key === "/";
	if (!keyIsHelp) return false;
	if (targetOwnsTyping(e.target as HTMLElement | null)) return false;
	if (platform === "mac") return e.metaKey && !e.ctrlKey && !e.altKey;
	return e.ctrlKey && !e.metaKey && !e.altKey;
}

export const SHORTCUT_REGISTRY: AppShortcut[] = [
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
		id: "review-drawer",
		label: "Toggle Review",
		mac: "⌘J",
		other: "Ctrl+J",
		predicate: isReviewDrawerShortcut,
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
		mac: "⌘/ or ⌘?",
		other: "Ctrl+/ or Ctrl+?",
		predicate: isShortcutsHelpShortcut,
	},
];
