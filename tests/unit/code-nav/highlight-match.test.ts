import { describe, expect, it } from "vitest";
import { highlightMatch } from "../../../src/features/code-nav/palette/highlight-match";

describe("highlightMatch", () => {
	it("splits the first case-insensitive occurrence into a hit segment", () => {
		expect(highlightMatch("parseConfig", "parse")).toEqual([
			{ text: "parse", hit: true },
			{ text: "Config", hit: false },
		]);
	});

	it("preserves original casing while matching case-insensitively", () => {
		expect(highlightMatch("ConfigParser", "parse")).toEqual([
			{ text: "Config", hit: false },
			{ text: "Parse", hit: true },
			{ text: "r", hit: false },
		]);
	});

	it("returns a single plain segment when there is no match", () => {
		expect(highlightMatch("foo", "xyz")).toEqual([{ text: "foo", hit: false }]);
	});

	it("returns a single plain segment for an empty query", () => {
		expect(highlightMatch("foo", "")).toEqual([{ text: "foo", hit: false }]);
	});
});
