import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(
	resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/app/shell.css"),
	"utf8",
);

// The base `.workflow-row { ... }` rule (not __header / ::before / :hover),
// with comments stripped so we assert on real declarations, not prose.
const baseRule = (/\.workflow-row\s*\{[^}]*\}/.exec(css)?.[0] ?? "").replace(
	/\/\*[\s\S]*?\*\//g,
	"",
);

/**
 * The sidebar workflow lens card must not overflow the sidebar and must not
 * read as a boxed card.
 *
 * `width: 100%` combined with the `margin-left: 24px` rail indent overflowed the
 * sidebar by 24px, clipping the right-aligned status badge. And the solid border
 * made it a heavy card. jsdom cannot compute layout, so we pin both intents in
 * the CSS text.
 */
describe(".workflow-row layout", () => {
	it("has a base rule", () => {
		expect(baseRule).not.toBe("");
	});

	it("does not force full width (would overflow with the rail indent)", () => {
		expect(baseRule).not.toMatch(/width:\s*100%/);
	});

	it("has no border (not a boxed card)", () => {
		expect(baseRule).not.toMatch(/\bborder:\s/);
	});

	it("has no background fill (flat, not a card)", () => {
		expect(baseRule).not.toMatch(/\bbackground:\s/);
	});

	it("has no top margin (sits tight under the worktree summary)", () => {
		expect(baseRule).not.toMatch(/\bmargin-top:\s/);
	});
});
