import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cssPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../src/app/shell.css",
);
const railSrc = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../src/features/review/components/ReviewRail.tsx",
);

const css = readFileSync(cssPath, "utf8");
const rail = readFileSync(railSrc, "utf8");

// The base `.shell-review-rail { ... }` rule (not __header / __scroll / __toolbar),
// comments stripped so we assert on real declarations.
const railRule = (/\.shell-review-rail\s*\{[^}]*\}/.exec(css)?.[0] ?? "").replace(
	/\/\*[\s\S]*?\*\//g,
	"",
);

/**
 * The review rail is a three-row grid (tabs / header-slot / scroll list). The
 * header slot is a React Fragment that can hold more than one child, and a
 * Fragment adds no DOM node — so each child would become its own grid item and
 * the flexible `minmax(0, 1fr)` row would land on the wrong element, stranding
 * the mark-viewed control. The fix is a single always-present
 * `.shell-review-rail__toolbar` wrapper. jsdom can't compute grid layout, so we
 * pin both intents in source text.
 */
describe(".shell-review-rail grid", () => {
	it("keeps the three-row template", () => {
		expect(railRule).toMatch(/grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)/);
	});

	it("wraps the header slot in exactly one .shell-review-rail__toolbar", () => {
		const matches = rail.match(/shell-review-rail__toolbar/g) ?? [];
		expect(matches.length).toBe(1);
		// The wrapper contains the header slot, not the scroll list.
		expect(rail).toMatch(
			/<div className="shell-review-rail__toolbar">\{header\}<\/div>/,
		);
	});
});
