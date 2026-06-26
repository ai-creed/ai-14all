import { describe, it, expect } from "vitest";
import {
	subsequenceMatch,
	matchCommands,
} from "../../../../src/features/command-palette/logic/command-match";
import type { Command } from "../../../../src/features/command-palette/logic/command";

const cmd = (
	over: Partial<Command> & { id: string; title: string },
): Command => ({
	group: "Test",
	run: () => {},
	...over,
});

const fixtures: Command[] = [
	cmd({ id: "term.new", title: "New terminal" }),
	cmd({ id: "layout.sidebar", title: "Toggle sidebar", keywords: ["panel"] }),
	cmd({ id: "review.open", title: "Open Review" }),
];

describe("subsequenceMatch", () => {
	it("matches an empty query against anything", () => {
		expect(subsequenceMatch("", "New terminal")).toBe(true);
	});
	it("matches a scattered subsequence", () => {
		expect(subsequenceMatch("nt", "New terminal")).toBe(true);
	});
	it("is case-insensitive", () => {
		expect(subsequenceMatch("NT", "new terminal")).toBe(true);
	});
	it("rejects characters out of order or absent", () => {
		// "tn" is a valid subsequence: t(index 4) → n(index 9) in "new terminal"
		expect(subsequenceMatch("tn", "New terminal")).toBe(true);
		expect(subsequenceMatch("xyz", "New terminal")).toBe(false);
		// "mr" — both letters present but reversed (r precedes m in "terminal"); no match
		expect(subsequenceMatch("mr", "New terminal")).toBe(false);
	});
});

describe("matchCommands", () => {
	it("returns all commands for an empty or whitespace query", () => {
		expect(matchCommands("", fixtures)).toHaveLength(3);
		expect(matchCommands("   ", fixtures)).toHaveLength(3);
	});
	it("filters by title subsequence", () => {
		expect(matchCommands("term", fixtures).map((c) => c.id)).toEqual([
			"term.new",
		]);
	});
	it("matches against keywords too", () => {
		expect(matchCommands("panel", fixtures).map((c) => c.id)).toEqual([
			"layout.sidebar",
		]);
	});
	it("returns nothing when no command matches", () => {
		expect(matchCommands("zzzzz", fixtures)).toEqual([]);
	});
	it("preserves input order", () => {
		expect(matchCommands("o", fixtures).map((c) => c.id)).toEqual([
			"layout.sidebar",
			"review.open",
		]);
	});
});
