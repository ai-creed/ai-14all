import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");

describe("markdown highlight import hygiene (spec D2/T4)", () => {
	it("MarkdownBody no longer imports a vendored highlight.js theme", () => {
		expect(
			read("../../../src/features/viewer/components/MarkdownBody.tsx"),
		).not.toContain("highlight.js/styles");
	});

	it("main.tsx imports hljs-tokens.css and not hljs-light.css", () => {
		const main = read("../../../src/main.tsx");
		expect(main).toContain("./styles/hljs-tokens.css");
		expect(main).not.toContain("hljs-light.css");
	});

	it("hljs-light.css is deleted from disk", () => {
		expect(
			existsSync(resolve(here, "../../../src/styles/hljs-light.css")),
		).toBe(false);
	});

	it("hljs-tokens.css colors come exclusively from --hljs-* tokens", () => {
		const sheet = read("../../../src/styles/hljs-tokens.css");
		for (const m of sheet.matchAll(/(?:color|background-color):\s*([^;]+);/g)) {
			expect(m[1].trim()).toMatch(/^(var\(--hljs-[a-z-]+\)|transparent)$/);
		}
	});

	it("leaves GitHub's purposely-unstyled scopes unstyled (spec D15)", () => {
		const sheet = read("../../../src/styles/hljs-tokens.css");
		for (const scope of [
			".hljs-char",
			".hljs-link",
			".hljs-params",
			".hljs-property",
			".hljs-punctuation",
			".hljs-tag",
		]) {
			expect(sheet).not.toContain(scope);
		}
	});
});
