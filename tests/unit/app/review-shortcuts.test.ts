import { describe, expect, it } from "vitest";
import { SHORTCUT_REGISTRY } from "../../../src/app/shortcut-registry";

function find(id: string) {
	const s = SHORTCUT_REGISTRY.find((x) => x.id === id);
	if (!s) throw new Error(`missing shortcut ${id}`);
	return s;
}

function ev(over: Partial<KeyboardEvent>): KeyboardEvent {
	return {
		key: "v",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		defaultPrevented: false,
		target: document.body,
		...over,
	} as unknown as KeyboardEvent;
}

describe("review.markViewed", () => {
	it("is registered with the expected binding", () => {
		expect(find("review.markViewed").mac).toBe("⌘⇧V");
	});

	it("markViewed fires on Cmd+Shift+V (mac)", () => {
		const p = find("review.markViewed").predicate;
		expect(p(ev({ key: "v", metaKey: true, shiftKey: true }), "mac")).toBe(
			true,
		);
		expect(p(ev({ key: "v", metaKey: true, shiftKey: false }), "mac")).toBe(
			false,
		);
	});

	it("does NOT fire while typing in an input", () => {
		const input = document.createElement("input");
		const p = find("review.markViewed").predicate;
		expect(
			p(ev({ key: "v", metaKey: true, shiftKey: true, target: input }), "mac"),
		).toBe(false);
	});
});
