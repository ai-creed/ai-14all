import { describe, it, expect } from "vitest";
import { SHORTCUT_REGISTRY } from "../../../src/app/shortcut-registry";

const entry = () => {
	const e = SHORTCUT_REGISTRY.find((s) => s.id === "command-palette");
	if (!e) throw new Error("command-palette entry missing");
	return e;
};

const ev = (over: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
	({
		defaultPrevented: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		ctrlKey: false,
		target: document.body,
		...over,
	}) as unknown as KeyboardEvent;

describe("command-palette shortcut", () => {
	it("is registered with the ⌘⇧K / Ctrl+Shift+K hints", () => {
		expect(entry().mac).toBe("⌘⇧K");
		expect(entry().other).toBe("Ctrl+Shift+K");
	});
	it("fires on Cmd+Shift+K on mac", () => {
		expect(
			entry().predicate(ev({ key: "k", metaKey: true, shiftKey: true }), "mac"),
		).toBe(true);
	});
	it("fires on Ctrl+Shift+K elsewhere", () => {
		expect(
			entry().predicate(
				ev({ key: "k", ctrlKey: true, shiftKey: true }),
				"other",
			),
		).toBe(true);
	});
	it("does NOT fire without Shift (that combo is terminal-clear)", () => {
		expect(entry().predicate(ev({ key: "k", metaKey: true }), "mac")).toBe(
			false,
		);
	});
	it("does NOT fire when typing into an input", () => {
		const input = document.createElement("input");
		expect(
			entry().predicate(
				ev({ key: "k", metaKey: true, shiftKey: true, target: input }),
				"mac",
			),
		).toBe(false);
	});
});
