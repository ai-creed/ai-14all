import { describe, it, expect } from "vitest";
import {
	SHORTCUT_REGISTRY,
	shortcutHint,
	type AppShortcut,
} from "../../../src/app/shortcut-registry";

describe("shortcutHint", () => {
	it("returns the mac label on mac", () => {
		expect(shortcutHint("⌘S", "Ctrl+S", "mac")).toBe("⌘S");
	});
	it("returns the Ctrl label on non-mac (Windows/Linux)", () => {
		expect(shortcutHint("⌘S", "Ctrl+S", "other")).toBe("Ctrl+S");
		expect(shortcutHint("⌘⇧L", "Ctrl+Shift+L", "other")).toBe("Ctrl+Shift+L");
	});
});

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
		"review.open",
		"review.fileNext",
		"review.filePrev",
		"rename-session",
		"shortcuts-help",
	];

	it("contains all required entries", () => {
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

describe("terminal-first ownership — all shortcuts", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	// Per-entry triggers that would fire on mac when focus is NOT in the terminal.
	const macTriggers: Record<string, Partial<KeyboardEvent>> = {
		"files-overlay": { metaKey: true, key: "p" },
		"note-sheet": { metaKey: true, key: ";" },
		"review.open": { metaKey: true, key: "j" },
		"review.fileNext": { metaKey: true, key: "." },
		"review.filePrev": { metaKey: true, key: "," },
		"rename-session": { metaKey: true, shiftKey: true, key: "R" },
		"shortcuts-help": { metaKey: true, key: "/" },
	};

	// Shortcuts that must fire even when focus is inside the terminal pane.
	// Cmd+P (Files) and Cmd+J (Review) are global navigation, not terminal input.
	const xtermShouldFire = new Set(["files-overlay", "review.open"]);

	it("only files-overlay and review.open fire when focus is inside .xterm; the rest stay blocked", () => {
		const target = xtermTarget();
		for (const id of Object.keys(macTriggers)) {
			const s = entry(id);
			const trigger = macTriggers[id];
			// Each predicate uses its own trigger so the guard, not a key mismatch, decides.
			expect(s.predicate(evt({ ...trigger, target }), "mac")).toBe(
				xtermShouldFire.has(id),
			);
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
			expect(s.predicate(evt({ ...trigger, target: child }), "mac")).toBe(
				false,
			);
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
			expect(s.predicate(evt({ ...trigger, target: textarea }), "mac")).toBe(
				true,
			);
		}
	});
});

describe("review.open predicate", () => {
	it("matches Cmd+J on mac", () => {
		expect(
			entry("review.open").predicate(evt({ metaKey: true, key: "j" }), "mac"),
		).toBe(true);
	});

	it("matches Ctrl+J on other", () => {
		expect(
			entry("review.open").predicate(evt({ ctrlKey: true, key: "j" }), "other"),
		).toBe(true);
	});

	it("does not match Cmd+Shift+J on mac", () => {
		expect(
			entry("review.open").predicate(
				evt({ metaKey: true, shiftKey: true, key: "J" }),
				"mac",
			),
		).toBe(false);
	});

	it("does not match Cmd+Alt+J on mac", () => {
		expect(
			entry("review.open").predicate(
				evt({ metaKey: true, altKey: true, key: "j" }),
				"mac",
			),
		).toBe(false);
	});

	it("does not match when typing in an input", () => {
		const input = document.createElement("input");
		expect(
			entry("review.open").predicate(
				evt({ metaKey: true, key: "j", target: input }),
				"mac",
			),
		).toBe(false);
	});
});

describe("review.fileNext predicate", () => {
	it("matches Cmd+. on mac", () => {
		expect(
			entry("review.fileNext").predicate(
				evt({ metaKey: true, key: "." }),
				"mac",
			),
		).toBe(true);
	});

	it("matches Ctrl+. on other", () => {
		expect(
			entry("review.fileNext").predicate(
				evt({ ctrlKey: true, key: "." }),
				"other",
			),
		).toBe(true);
	});

	it("does not match Cmd+Shift+. on mac (hunk shortcut)", () => {
		expect(
			entry("review.fileNext").predicate(
				evt({ metaKey: true, shiftKey: true, key: "." }),
				"mac",
			),
		).toBe(false);
	});

	it("does not match Cmd+Alt+. on mac", () => {
		expect(
			entry("review.fileNext").predicate(
				evt({ metaKey: true, altKey: true, key: "." }),
				"mac",
			),
		).toBe(false);
	});

	it("does not match when typing in an input", () => {
		const input = document.createElement("input");
		expect(
			entry("review.fileNext").predicate(
				evt({ metaKey: true, key: ".", target: input }),
				"mac",
			),
		).toBe(false);
	});
});

describe("review.filePrev predicate", () => {
	it("matches Cmd+, on mac", () => {
		expect(
			entry("review.filePrev").predicate(
				evt({ metaKey: true, key: "," }),
				"mac",
			),
		).toBe(true);
	});

	it("matches Ctrl+, on other", () => {
		expect(
			entry("review.filePrev").predicate(
				evt({ ctrlKey: true, key: "," }),
				"other",
			),
		).toBe(true);
	});

	it("does not match Cmd+Shift+, on mac (hunk shortcut)", () => {
		expect(
			entry("review.filePrev").predicate(
				evt({ metaKey: true, shiftKey: true, key: "," }),
				"mac",
			),
		).toBe(false);
	});

	it("does not match Cmd+Alt+, on mac", () => {
		expect(
			entry("review.filePrev").predicate(
				evt({ metaKey: true, altKey: true, key: "," }),
				"mac",
			),
		).toBe(false);
	});

	it("does not match when typing in an input", () => {
		const input = document.createElement("input");
		expect(
			entry("review.filePrev").predicate(
				evt({ metaKey: true, key: ",", target: input }),
				"mac",
			),
		).toBe(false);
	});
});

describe("terminal.layout predicate", () => {
	it("matches Cmd+Shift+L on mac", () => {
		expect(
			entry("terminal.layout").predicate(
				evt({ metaKey: true, shiftKey: true, key: "L" }),
				"mac",
			),
		).toBe(true);
	});
	it("matches Ctrl+Shift+L on other", () => {
		expect(
			entry("terminal.layout").predicate(
				evt({ ctrlKey: true, shiftKey: true, key: "L" }),
				"other",
			),
		).toBe(true);
	});
	it("does not match plain Cmd+L (no shift)", () => {
		expect(
			entry("terminal.layout").predicate(
				evt({ metaKey: true, key: "l" }),
				"mac",
			),
		).toBe(false);
	});
	it("fires inside the terminal (xterm)", () => {
		const target = xtermTarget();
		expect(
			entry("terminal.layout").predicate(
				evt({ metaKey: true, shiftKey: true, key: "L", target }),
				"mac",
			),
		).toBe(true);
	});
	it("terminal.toggleSplit is removed from the registry", () => {
		expect(
			SHORTCUT_REGISTRY.find((s) => s.id === "terminal.toggleSplit"),
		).toBeUndefined();
	});
});
