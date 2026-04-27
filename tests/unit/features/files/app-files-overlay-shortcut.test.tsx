import { describe, it, expect } from "vitest";
import { isFilesOverlayShortcut } from "../../../../src/app/files-overlay-shortcut";

function evt(partial: Partial<KeyboardEvent>): KeyboardEvent {
	return {
		key: "p",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		defaultPrevented: false,
		target: document.body,
		...partial,
	} as unknown as KeyboardEvent;
}

describe("isFilesOverlayShortcut", () => {
	it("matches Cmd+P on macOS", () => {
		expect(
			isFilesOverlayShortcut(evt({ metaKey: true, key: "p" }), "mac"),
		).toBe(true);
	});

	it("does not match Cmd+Shift+P on macOS (that opens shortcuts help)", () => {
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, shiftKey: true, key: "p" }),
				"mac",
			),
		).toBe(false);
	});

	it("matches Ctrl+Shift+P on Windows/Linux", () => {
		expect(
			isFilesOverlayShortcut(
				evt({ ctrlKey: true, shiftKey: true, key: "P" }),
				"other",
			),
		).toBe(true);
	});

	it("does not match plain Ctrl+P on Windows/Linux", () => {
		expect(
			isFilesOverlayShortcut(evt({ ctrlKey: true, key: "p" }), "other"),
		).toBe(false);
	});

	it("does not match when the event was already defaultPrevented", () => {
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", defaultPrevented: true }),
				"mac",
			),
		).toBe(false);
	});

	it("does not match when target is inside an xterm terminal element", () => {
		const terminal = document.createElement("div");
		terminal.className = "xterm";
		const child = document.createElement("div");
		terminal.appendChild(child);
		document.body.appendChild(terminal);
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: child }),
				"mac",
			),
		).toBe(false);
		terminal.remove();
	});

	it("does not match when target is inside an open dialog", () => {
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		const child = document.createElement("input");
		dialog.appendChild(child);
		document.body.appendChild(dialog);
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: child }),
				"mac",
			),
		).toBe(false);
		dialog.remove();
	});

	it("does not match when target is an <input> in the page chrome", () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: input }),
				"mac",
			),
		).toBe(false);
		input.remove();
	});

	it("does not match when target is a <textarea>", () => {
		const ta = document.createElement("textarea");
		document.body.appendChild(ta);
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: ta }),
				"mac",
			),
		).toBe(false);
		ta.remove();
	});

	it("does not match when target is a <select>", () => {
		const sel = document.createElement("select");
		document.body.appendChild(sel);
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: sel }),
				"mac",
			),
		).toBe(false);
		sel.remove();
	});

	it("does not match when target is a contenteditable element", () => {
		const div = document.createElement("div");
		div.setAttribute("contenteditable", "true");
		document.body.appendChild(div);
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: div }),
				"mac",
			),
		).toBe(false);
		div.remove();
	});

	it("does not match when target has role=textbox", () => {
		const div = document.createElement("div");
		div.setAttribute("role", "textbox");
		document.body.appendChild(div);
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: div }),
				"mac",
			),
		).toBe(false);
		div.remove();
	});

	it("does not match when target is inside a writable Monaco editor surface", () => {
		const monaco = document.createElement("div");
		monaco.className = "monaco-editor";
		const child = document.createElement("div");
		monaco.appendChild(child);
		document.body.appendChild(monaco);
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: child }),
				"mac",
			),
		).toBe(false);
		monaco.remove();
	});

	it("matches when target is inside a read-only Monaco editor (FileViewer/DiffViewer)", () => {
		const wrapper = document.createElement("div");
		wrapper.setAttribute("data-readonly-editor", "true");
		const monaco = document.createElement("div");
		monaco.className = "monaco-editor";
		const child = document.createElement("div");
		monaco.appendChild(child);
		wrapper.appendChild(monaco);
		document.body.appendChild(wrapper);
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: child }),
				"mac",
			),
		).toBe(true);
		wrapper.remove();
	});

	it("matches when target is a plain body / non-terminal element", () => {
		expect(
			isFilesOverlayShortcut(
				evt({ metaKey: true, key: "p", target: document.body }),
				"mac",
			),
		).toBe(true);
	});
});
