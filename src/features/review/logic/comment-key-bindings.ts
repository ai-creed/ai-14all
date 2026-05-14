import type { editor as MonacoEditor } from "monaco-editor";

export type CommentKeyHandlers = {
	addAtCaret: () => void;
	nextThread: () => void;
	prevThread: () => void;
	editFocused: () => void;
	toggleAddressedFocused: () => void;
};

export type CommentKeyBindings = {
	add: number;
	next: number;
	prev: number;
	edit: number;
	toggleAddressed: number;
};

// Monaco KeyCode / KeyMod numeric values, matched from Monaco's ESM source.
// Using literals here avoids a runtime import of monaco-editor (which fails in
// Node / vitest because Monaco bundles browser-only APIs).
const KeyMod_CtrlCmd = 2048;
const KeyMod_Shift = 1024;
const KeyCode_KeyA = 31;
const KeyCode_KeyE = 35;
const KeyCode_KeyJ = 40;
const KeyCode_KeyK = 41;
const KeyCode_KeyX = 54;

export function installCommentKeyBindings(
	editor: MonacoEditor.IStandaloneCodeEditor,
	handlers: CommentKeyHandlers,
): CommentKeyBindings {
	const keys: CommentKeyBindings = {
		add: KeyMod_CtrlCmd | KeyMod_Shift | KeyCode_KeyA,
		next: KeyCode_KeyJ,
		prev: KeyCode_KeyK,
		edit: KeyCode_KeyE,
		toggleAddressed: KeyCode_KeyX,
	};
	editor.addCommand(keys.add, handlers.addAtCaret);
	editor.addCommand(keys.next, handlers.nextThread);
	editor.addCommand(keys.prev, handlers.prevThread);
	editor.addCommand(keys.edit, handlers.editFocused);
	editor.addCommand(keys.toggleAddressed, handlers.toggleAddressedFocused);
	return keys;
}
