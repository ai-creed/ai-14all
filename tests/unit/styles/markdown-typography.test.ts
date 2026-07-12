import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(resolve(here, "../../../src/app/shell.css"), "utf8");
const main = readFileSync(resolve(here, "../../../src/main.tsx"), "utf8");

describe("markdown reading font (spec D18)", () => {
	it("defines the --font-reading token with Hanken Grotesk first", () => {
		expect(shell).toMatch(
			/--font-reading:[\s\S]{0,40}?"Hanken Grotesk Variable"/,
		);
	});

	it("main.tsx imports the self-hosted reading font", () => {
		expect(main).toContain("@fontsource-variable/hanken-grotesk");
	});
});
