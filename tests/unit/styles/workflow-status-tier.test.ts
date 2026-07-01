import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(
	resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/app/shell.css"),
	"utf8",
);

/**
 * Guards spec D4: a *done* workflow badge adopts the quiet "ready" tier and must
 * NOT keep the green `[data-status="done"]` pill tint. Because
 * `.workflow-row__status[data-tier="ready"]` and `.workflow-row__status[data-status="done"]`
 * have equal specificity, the later `done` rule would win and re-tint the badge.
 * The fix is a combined-specificity override; jsdom cannot compute stylesheet
 * cascade, so we assert the override exists in the CSS text.
 */
describe("workflow status ready-tier override", () => {
	it("defines a combined done+ready override that clears the pill tint", () => {
		const rule =
			/\.workflow-row__status\[data-status="done"\]\[data-tier="ready"\]\s*\{[^}]*background:\s*none/;
		expect(css).toMatch(rule);
	});

	it("places the done+ready override after the plain data-status=done tint rule", () => {
		const doneTint = css.indexOf('.workflow-row__status[data-status="done"] {');
		const override = css.indexOf(
			'.workflow-row__status[data-status="done"][data-tier="ready"]',
		);
		expect(doneTint).toBeGreaterThanOrEqual(0);
		expect(override).toBeGreaterThan(doneTint);
	});
});
