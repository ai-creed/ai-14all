import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(resolve(here, "../../../src/app/shell.css"), "utf8");
const main = readFileSync(resolve(here, "../../../src/main.tsx"), "utf8");
const tui = readFileSync(resolve(here, "../../../src/styles/tui.css"), "utf8");

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

describe("markdown typography restores Tailwind-preflight defaults (spec D5-D13)", () => {
	it("gives every heading level an explicit font-size", () => {
		expect(shell).toMatch(/\.shell-md-body h1\s*{[^}]*font-size:\s*2em/);
		expect(shell).toMatch(/\.shell-md-body h2\s*{[^}]*font-size:\s*1\.5em/);
		expect(shell).toMatch(/\.shell-md-body h3\s*{[^}]*font-size:\s*1\.25em/);
		expect(shell).toMatch(/\.shell-md-body h4\s*{[^}]*font-size:\s*1em/);
		expect(shell).toMatch(/\.shell-md-body h5\s*{[^}]*font-size:\s*0\.875em/);
		expect(shell).toMatch(/\.shell-md-body h6\s*{[^}]*font-size:\s*0\.85em/);
	});

	it("restores list markers preflight stripped", () => {
		expect(shell).toMatch(/\.shell-md-body ul\s*{[^}]*list-style:\s*disc/);
		expect(shell).toMatch(/\.shell-md-body ol\s*{[^}]*list-style:\s*decimal/);
	});

	it("styles hr with a themed rule", () => {
		expect(shell).toMatch(
			/\.shell-md-body hr\s*{[^}]*border-top:\s*2px solid var\(--panel-border\)/,
		);
	});

	it("sets the reading font on the body, with no width cap (D5 revised)", () => {
		expect(shell).toMatch(
			/\.shell-md-body\s*{[^}]*font-family:\s*var\(--font-reading\)/,
		);
		// Vu dropped the 72ch reading measure (2026-07-13): the body fills
		// whatever width the pane gives it.
		expect(shell).not.toMatch(/\.shell-md-body\s*{[^}]*max-width/);
	});

	it("opts task-list items out of list markers", () => {
		expect(shell).toMatch(
			/\.shell-md-body li\.task-list-item\s*{[^}]*list-style:\s*none/,
		);
	});

	it("zebra-stripes table bodies", () => {
		expect(shell).toMatch(/\.shell-md-body tbody tr:nth-child\(2n\)/);
	});

	it("collapsed the duplicated wrapper selectors (spec D1)", () => {
		// The wrappers survive exactly once each — the shared layout
		// (padding-only) rule. All document styling lives on .shell-md-body.
		expect(shell.match(/\.shell-md-preview__body/g)).toHaveLength(1);
		expect(shell.match(/\.shell-md-modal__body/g)).toHaveLength(1);
	});

	it("tui.css sheds the patches that became base behavior (spec D3)", () => {
		expect(tui).not.toContain("shell-md-modal__body");
		expect(tui).not.toContain("shell-md-preview__body");
		expect(tui).toMatch(/\.shell-md-body\s+:not\(pre\)\s*>\s*code/);
	});
});
