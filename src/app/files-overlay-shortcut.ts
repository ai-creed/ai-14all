export type Platform = "mac" | "other";

export function detectPlatform(): Platform {
	if (typeof navigator === "undefined") return "other";
	return navigator.platform.toUpperCase().includes("MAC") ? "mac" : "other";
}

function targetOwnsTyping(target: HTMLElement | null): boolean {
	if (!target || typeof target.closest !== "function") return false;

	// Skip .xterm BEFORE the generic TEXTAREA guard below: Cmd+P (Files) is global
	// navigation that must fire even when the terminal pane holds focus. xterm
	// parks focus in a hidden <textarea class="xterm-helper-textarea">, which the
	// TEXTAREA guard would otherwise swallow. The terminal binds no Cmd+P (see
	// TerminalPane attachCustomKeyEventHandler: only Shift+Enter, Cmd/Ctrl+F,
	// Cmd/Ctrl+K), so there is no terminal shortcut to lose. Mirrors the registry's
	// targetOwnsTypingExcludingXterm, which already lets Cmd+J through.
	if (target.closest(".xterm")) return false;

	if (target.closest('[role="dialog"]')) return true;
	// Monaco's .inputarea is a <textarea>, so check Monaco BEFORE the generic
	// TEXTAREA guard. Read-only editors (FileViewer, DiffViewer) are wrapped in
	// [data-readonly-editor] — shortcuts should still fire from inside them.
	const monacoEl = target.closest(".monaco-editor");
	if (monacoEl) return !monacoEl.closest("[data-readonly-editor]");
	if (target.closest('[contenteditable="true"]')) return true;
	if (target.closest('[role="textbox"]')) return true;

	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

	return false;
}

export function isFilesOverlayShortcut(
	event: KeyboardEvent,
	platform: Platform,
): boolean {
	if (event.defaultPrevented) return false;

	const keyIsP = event.key === "p" || event.key === "P";
	if (!keyIsP) return false;
	if (event.altKey) return false;

	if (targetOwnsTyping(event.target as HTMLElement | null)) return false;

	if (platform === "mac") {
		return event.metaKey && !event.shiftKey && !event.ctrlKey;
	}
	return event.ctrlKey && event.shiftKey && !event.metaKey;
}
