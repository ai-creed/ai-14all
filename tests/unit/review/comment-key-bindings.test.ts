import { describe, expect, it, vi } from "vitest";
import { installCommentKeyBindings } from "../../../src/features/review/logic/comment-key-bindings";
import type { editor as MonacoEditor } from "monaco-editor";

type CommandFn = () => void;
function fakeCodeEditor() {
	const commands = new Map<number, CommandFn>();
	const editor = {
		addCommand: (key: number, fn: CommandFn) => {
			commands.set(key, fn);
			return null;
		},
	} as unknown as MonacoEditor.IStandaloneCodeEditor;
	const fire = (key: number) => commands.get(key)?.();
	return { editor, fire };
}

describe("installCommentKeyBindings", () => {
	it("registers commands on the (modified) code editor and fires handlers", () => {
		const { editor, fire } = fakeCodeEditor();
		const handlers = {
			addAtCaret: vi.fn(),
			nextThread: vi.fn(),
			prevThread: vi.fn(),
			editFocused: vi.fn(),
			toggleAddressedFocused: vi.fn(),
		};
		const KEY = installCommentKeyBindings(editor, handlers);
		fire(KEY.add);
		fire(KEY.next);
		fire(KEY.prev);
		fire(KEY.edit);
		fire(KEY.toggleAddressed);
		expect(handlers.addAtCaret).toHaveBeenCalled();
		expect(handlers.nextThread).toHaveBeenCalled();
		expect(handlers.prevThread).toHaveBeenCalled();
		expect(handlers.editFocused).toHaveBeenCalled();
		expect(handlers.toggleAddressedFocused).toHaveBeenCalled();
	});
});
