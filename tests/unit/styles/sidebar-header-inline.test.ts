import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(
	resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/app/shell.css"),
	"utf8",
);

/**
 * Guards the fix for the stranded ready dot + status. The worktree header line
 * (`.shell-sidebar__item-head`) must lay the title and the inline ready status
 * out horizontally. A regression to `flex-direction: column` (or a non-flex
 * display) re-strands the dot and "workflow done" on their own lines below the
 * title — exactly the bug this replaces. jsdom cannot compute layout, so we
 * assert the rule in the CSS text.
 */
describe("sidebar header line layout", () => {
	it("declares .shell-sidebar__item-head as a horizontal flex row", () => {
		const rule =
			/\.shell-sidebar__item-head\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
		expect(rule).toMatch(/display:\s*flex/);
		expect(rule).not.toMatch(/flex-direction:\s*column/);
	});
});
