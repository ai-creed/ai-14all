import { describe, it, expect } from "vitest";
import {
	SHORTCUT_REGISTRY,
	type AppShortcut,
} from "../../../src/app/shortcut-registry";

// Minimal KeyboardEvent factory — only sets the fields the predicates inspect.
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

function entry(id: string): AppShortcut {
	const s = SHORTCUT_REGISTRY.find((e) => e.id === id);
	if (!s) throw new Error(`No registry entry for id="${id}"`);
	return s;
}

function xtermTarget(): HTMLElement {
	const wrap = document.createElement("div");
	wrap.className = "xterm";
	const child = document.createElement("div");
	wrap.appendChild(child);
	document.body.appendChild(wrap);
	return child;
}

describe("SHORTCUT_REGISTRY structure", () => {
	const requiredIds = [
		"files-overlay",
		"note-sheet",
		"review-drawer",
		"rename-session",
		"shortcuts-help",
	];

	it("contains all five required entries", () => {
		const ids = SHORTCUT_REGISTRY.map((s) => s.id);
		for (const id of requiredIds) {
			expect(ids).toContain(id);
		}
	});

	it("every entry has non-empty label, mac, and other display strings", () => {
		for (const s of SHORTCUT_REGISTRY) {
			expect(s.label.length).toBeGreaterThan(0);
			expect(s.mac.length).toBeGreaterThan(0);
			expect(s.other.length).toBeGreaterThan(0);
		}
	});
});

describe("files-overlay predicate", () => {
	it("matches Cmd+P on mac", () => {
		expect(
			entry("files-overlay").predicate(evt({ metaKey: true, key: "p" }), "mac"),
		).toBe(true);
	});
	it("does not match Cmd+Shift+P on mac (that opens shortcuts help)", () => {
		expect(
			entry("files-overlay").predicate(
				evt({ metaKey: true, shiftKey: true, key: "P" }),
				"mac",
			),
		).toBe(false);
	});
	it("matches Ctrl+Shift+P on other", () => {
		expect(
			entry("files-overlay").predicate(
				evt({ ctrlKey: true, shiftKey: true, key: "P" }),
				"other",
			),
		).toBe(true);
	});
});

describe("note-sheet predicate", () => {
	it("matches Cmd+; on mac", () => {
		expect(
			entry("note-sheet").predicate(evt({ metaKey: true, key: ";" }), "mac"),
		).toBe(true);
	});
	it("matches Ctrl+; on other", () => {
		expect(
			entry("note-sheet").predicate(evt({ ctrlKey: true, key: ";" }), "other"),
		).toBe(true);
	});
	it("does not match Cmd+; when altKey is held", () => {
		expect(
			entry("note-sheet").predicate(
				evt({ metaKey: true, altKey: true, key: ";" }),
				"mac",
			),
		).toBe(false);
	});
	it("does not match Ctrl+Shift+; on other (shiftKey held)", () => {
		expect(
			entry("note-sheet").predicate(
				evt({ ctrlKey: true, shiftKey: true, key: ";" }),
				"other",
			),
		).toBe(false);
	});
	it("does not match when defaultPrevented", () => {
		expect(
			entry("note-sheet").predicate(
				evt({ metaKey: true, key: ";", defaultPrevented: true }),
				"mac",
			),
		).toBe(false);
	});
});

describe("review-drawer predicate", () => {
	it("matches Cmd+J on mac", () => {
		expect(
			entry("review-drawer").predicate(evt({ metaKey: true, key: "j" }), "mac"),
		).toBe(true);
	});
	it("matches Cmd+J (uppercase) on mac", () => {
		expect(
			entry("review-drawer").predicate(evt({ metaKey: true, key: "J" }), "mac"),
		).toBe(true);
	});
	it("matches Ctrl+J on other", () => {
		expect(
			entry("review-drawer").predicate(
				evt({ ctrlKey: true, key: "j" }),
				"other",
			),
		).toBe(true);
	});
	it("does not match when shiftKey is held", () => {
		expect(
			entry("review-drawer").predicate(
				evt({ metaKey: true, shiftKey: true, key: "j" }),
				"mac",
			),
		).toBe(false);
	});
	it("does not match when defaultPrevented", () => {
		expect(
			entry("review-drawer").predicate(
				evt({ metaKey: true, key: "j", defaultPrevented: true }),
				"mac",
			),
		).toBe(false);
	});
});

describe("rename-session predicate", () => {
	it("matches Cmd+Shift+R on mac", () => {
		expect(
			entry("rename-session").predicate(
				evt({ metaKey: true, shiftKey: true, key: "R" }),
				"mac",
			),
		).toBe(true);
	});
	it("matches Ctrl+Alt+R on other", () => {
		expect(
			entry("rename-session").predicate(
				evt({ ctrlKey: true, altKey: true, key: "r" }),
				"other",
			),
		).toBe(true);
	});
	it("does not match plain Cmd+R on mac (no shift)", () => {
		expect(
			entry("rename-session").predicate(
				evt({ metaKey: true, key: "r" }),
				"mac",
			),
		).toBe(false);
	});
	it("does not match plain Ctrl+R on other (no alt)", () => {
		expect(
			entry("rename-session").predicate(
				evt({ ctrlKey: true, key: "r" }),
				"other",
			),
		).toBe(false);
	});
	it("does not match when defaultPrevented", () => {
		expect(
			entry("rename-session").predicate(
				evt({
					metaKey: true,
					shiftKey: true,
					key: "R",
					defaultPrevented: true,
				}),
				"mac",
			),
		).toBe(false);
	});
});

describe("shortcuts-help predicate", () => {
	it("matches Cmd+/ on mac", () => {
		expect(
			entry("shortcuts-help").predicate(
				evt({ metaKey: true, key: "/" }),
				"mac",
			),
		).toBe(true);
	});
	it("matches Cmd+? on mac (Shift+/ key)", () => {
		expect(
			entry("shortcuts-help").predicate(
				evt({ metaKey: true, shiftKey: true, key: "?" }),
				"mac",
			),
		).toBe(true);
	});
	it("matches Ctrl+/ on other", () => {
		expect(
			entry("shortcuts-help").predicate(
				evt({ ctrlKey: true, key: "/" }),
				"other",
			),
		).toBe(true);
	});
	it("matches Ctrl+? on other", () => {
		expect(
			entry("shortcuts-help").predicate(
				evt({ ctrlKey: true, shiftKey: true, key: "?" }),
				"other",
			),
		).toBe(true);
	});
	it("does not match when defaultPrevented", () => {
		expect(
			entry("shortcuts-help").predicate(
				evt({ metaKey: true, key: "/", defaultPrevented: true }),
				"mac",
			),
		).toBe(false);
	});
});

describe("review.expand shortcut", () => {
	it("fires on ⌘⇧J (mac)", () => {
		const s = entry("review.expand");
		expect(
			s.predicate(evt({ key: "J", metaKey: true, shiftKey: true }), "mac"),
		).toBe(true);
		expect(
			s.predicate(evt({ key: "j", metaKey: true, shiftKey: true }), "mac"),
		).toBe(true);
	});

	it("fires on Ctrl+Shift+J (other)", () => {
		const s = entry("review.expand");
		expect(
			s.predicate(evt({ key: "J", ctrlKey: true, shiftKey: true }), "other"),
		).toBe(true);
	});

	it("does not fire without Shift", () => {
		const s = entry("review.expand");
		expect(
			s.predicate(evt({ key: "j", metaKey: true, shiftKey: false }), "mac"),
		).toBe(false);
	});

	it("does not fire when defaultPrevented", () => {
		const s = entry("review.expand");
		expect(
			s.predicate(
				evt({
					key: "J",
					metaKey: true,
					shiftKey: true,
					defaultPrevented: true,
				}),
				"mac",
			),
		).toBe(false);
	});

	it("does not fire when focus is inside xterm", () => {
		const s = entry("review.expand");
		const target = xtermTarget();
		expect(
			s.predicate(
				evt({ key: "J", metaKey: true, shiftKey: true, target }),
				"mac",
			),
		).toBe(false);
	});
});

describe("terminal-first ownership — all shortcuts", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	// Per-entry triggers that would fire on mac when focus is NOT in the terminal.
	const macTriggers: Record<string, Partial<KeyboardEvent>> = {
		"files-overlay": { metaKey: true, key: "p" },
		"note-sheet": { metaKey: true, key: ";" },
		"review-drawer": { metaKey: true, key: "j" },
		"review.expand": { metaKey: true, shiftKey: true, key: "J" },
		"rename-session": { metaKey: true, shiftKey: true, key: "R" },
		"shortcuts-help": { metaKey: true, key: "/" },
	};

	it("no shortcut predicate fires when focus is inside .xterm", () => {
		const target = xtermTarget();
		for (const s of SHORTCUT_REGISTRY) {
			const trigger = macTriggers[s.id];
			// Each predicate uses its own trigger so the guard, not a key mismatch, causes the false.
			expect(s.predicate(evt({ ...trigger, target }), "mac")).toBe(false);
		}
	});

	it("no shortcut predicate fires when focus is inside a writable .monaco-editor", () => {
		const monaco = document.createElement("div");
		monaco.className = "monaco-editor";
		const child = document.createElement("div");
		monaco.appendChild(child);
		document.body.appendChild(monaco);
		for (const s of SHORTCUT_REGISTRY) {
			const trigger = macTriggers[s.id];
			expect(s.predicate(evt({ ...trigger, target: child }), "mac")).toBe(false);
		}
	});

	it("all shortcut predicates fire when focus is inside a read-only .monaco-editor", () => {
		const wrapper = document.createElement("div");
		wrapper.setAttribute("data-readonly-editor", "true");
		const monaco = document.createElement("div");
		monaco.className = "monaco-editor";
		const child = document.createElement("div");
		monaco.appendChild(child);
		wrapper.appendChild(monaco);
		document.body.appendChild(wrapper);
		for (const s of SHORTCUT_REGISTRY) {
			const trigger = macTriggers[s.id];
			if (!trigger) continue;
			expect(s.predicate(evt({ ...trigger, target: child }), "mac")).toBe(true);
		}
	});

	it("all shortcut predicates fire when Monaco's internal textarea has focus in a read-only editor", () => {
		// Monaco focuses a hidden <textarea> (.inputarea) — must not be caught
		// by the generic TEXTAREA guard before the [data-readonly-editor] check.
		const wrapper = document.createElement("div");
		wrapper.setAttribute("data-readonly-editor", "true");
		const monaco = document.createElement("div");
		monaco.className = "monaco-editor";
		const textarea = document.createElement("textarea");
		textarea.className = "inputarea monaco-mouse-cursor-text";
		monaco.appendChild(textarea);
		wrapper.appendChild(monaco);
		document.body.appendChild(wrapper);
		for (const s of SHORTCUT_REGISTRY) {
			const trigger = macTriggers[s.id];
			if (!trigger) continue;
			expect(
				s.predicate(evt({ ...trigger, target: textarea }), "mac"),
			).toBe(true);
		}
	});
});
