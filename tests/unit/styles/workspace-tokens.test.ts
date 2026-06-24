import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(
	resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/styles/tokens.css"),
	"utf8",
);

describe("workspace tokens", () => {
	it("defines the ws-fs ladder", () => {
		for (const t of ["header", "repo", "branch", "path", "chip"]) {
			expect(css).toContain(`--ws-fs-${t}:`);
		}
	});

	it("defines a solid --rail in every theme (no alpha)", () => {
		// one in :root (dark) + light + warm + tui = 4 declarations
		const decls = css.match(/--rail:\s*[^;]+;/g) ?? [];
		expect(decls.length).toBe(4);
		for (const d of decls) {
			expect(d).not.toMatch(/color-mix|transparent|\/\s*[\d.%]/); // no alpha
		}
	});
});
