export type TargetOwnsTypingOptions = {
	/**
	 * When true, a target inside the terminal (`.xterm`) does NOT count as owning
	 * typing, so the shortcut still fires from a focused terminal pane. Used by
	 * global navigation (Cmd+P / Cmd+J) and the terminal-management shortcuts.
	 * Defaults to false: the terminal owns its keystrokes.
	 */
	allowXterm?: boolean;
};

/**
 * Whether the element that would receive a keystroke "owns typing" — i.e. the
 * user is typing into it and an app keyboard shortcut should stay out of the
 * way. The single source of truth for every shortcut predicate's focus gate.
 *
 * Order matters:
 * - `.xterm` is checked first because the terminal parks focus in a hidden
 *   `<textarea class="xterm-helper-textarea">`, which the generic TEXTAREA guard
 *   below would otherwise swallow. `allowXterm` decides whether that counts as
 *   owning typing (see TerminalPane's attachCustomKeyEventHandler — it binds no
 *   Cmd+P/Cmd+J, so those are safe to let through).
 * - Monaco is checked before the generic TEXTAREA guard too, because its input
 *   sink (`.inputarea`) is also a `<textarea>`; read-only editors
 *   (`[data-readonly-editor]`, e.g. FileViewer/DiffViewer) let shortcuts through.
 */
export function targetOwnsTyping(
	target: HTMLElement | null,
	options: TargetOwnsTypingOptions = {},
): boolean {
	if (!target || typeof target.closest !== "function") return false;
	if (target.closest(".xterm")) return !options.allowXterm;
	if (target.closest('[role="dialog"]')) return true;
	const monacoEl = target.closest(".monaco-editor");
	if (monacoEl) return !monacoEl.closest("[data-readonly-editor]");
	if (target.closest('[contenteditable="true"]')) return true;
	if (target.closest('[role="textbox"]')) return true;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	return false;
}
