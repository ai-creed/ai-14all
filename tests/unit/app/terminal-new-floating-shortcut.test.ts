import { describe, it, expect } from "vitest";
import { SHORTCUT_REGISTRY } from "../../../src/app/shortcut-registry";

function findPredicate(id: string) {
	const entry = SHORTCUT_REGISTRY.find((s) => s.id === id);
	if (!entry) throw new Error(`no shortcut ${id}`);
	return entry;
}

function key(
	overrides: Partial<KeyboardEvent> & { target?: EventTarget | null },
): KeyboardEvent {
	return {
		key: "t",
		metaKey: false,
		ctrlKey: false,
		shiftKey: true,
		altKey: false,
		defaultPrevented: false,
		target: document.createElement("div"),
		...overrides,
	} as unknown as KeyboardEvent;
}

describe("terminal.newFloating shortcut", () => {
	it("is registered with ⌘⇧T / Ctrl+Shift+T", () => {
		const entry = findPredicate("terminal.newFloating");
		expect(entry.mac).toBe("⌘⇧T");
		expect(entry.other).toBe("Ctrl+Shift+T");
	});

	it("fires on Cmd+Shift+T (mac)", () => {
		const { predicate } = findPredicate("terminal.newFloating");
		expect(predicate(key({ metaKey: true, shiftKey: true }), "mac")).toBe(true);
	});

	it("does NOT fire on plain Cmd+T (that is terminal.new)", () => {
		const { predicate } = findPredicate("terminal.newFloating");
		expect(predicate(key({ metaKey: true, shiftKey: false }), "mac")).toBe(false);
	});

	it("fires even when an xterm textarea is focused", () => {
		const xterm = document.createElement("div");
		xterm.className = "xterm";
		const textarea = document.createElement("textarea");
		textarea.className = "xterm-helper-textarea";
		xterm.appendChild(textarea);
		document.body.appendChild(xterm);
		const { predicate } = findPredicate("terminal.newFloating");
		expect(
			predicate(key({ metaKey: true, shiftKey: true, target: textarea }), "mac"),
		).toBe(true);
		document.body.removeChild(xterm);
	});
});
