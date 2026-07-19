import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `.shell-list__item-row*`/`.shell-list__item-name` live in primitives.css;
// `.shell-review-row-viewed` is review-specific and lives in review.css.
// Concatenated so the shared `rule()` lookup below can find either.
const css =
	readFileSync(
		resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../../../src/styles/modules/primitives.css",
		),
		"utf8",
	) +
	readFileSync(
		resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../../../src/styles/modules/review.css",
		),
		"utf8",
	);

// Capture a single selector's declaration block, comments stripped.
function rule(selector: string): string {
	const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`${esc}\\s*\\{[^}]*\\}`);
	return (re.exec(css)?.[0] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The per-row "Viewed" control floats at the top-right corner of the open file
 * row (GitHub-style) instead of taking horizontal space beside the filename —
 * otherwise a long/wrapped filename gets squeezed and the two bordered boxes
 * read as disconnected. jsdom cannot compute layout, so the positioning intent
 * is pinned in the CSS text.
 */
describe("row viewed toggle layout", () => {
	it("anchors the row as a positioning context", () => {
		expect(rule(".shell-list__item-row")).toMatch(/position:\s*relative/);
	});

	it("floats the toggle absolutely at the top-right corner", () => {
		const r = rule(".shell-review-row-viewed");
		expect(r).toMatch(/position:\s*absolute/);
		expect(r).toMatch(/top:\s*8px/);
		expect(r).toMatch(/right:\s*8px/);
	});

	it("reserves right-hand space on the open row so the chip never overlaps content", () => {
		expect(rule(".shell-list__item-row--has-toggle .shell-list__item")).toMatch(
			/padding-right:/,
		);
	});

	it("truncates long file names with an ellipsis so the row never overflows", () => {
		const r = rule(".shell-list__item-name");
		expect(r).toMatch(/overflow:\s*hidden/);
		expect(r).toMatch(/text-overflow:\s*ellipsis/);
		expect(r).toMatch(/white-space:\s*nowrap/);
		expect(r).toMatch(/min-width:\s*0/);
	});
});
