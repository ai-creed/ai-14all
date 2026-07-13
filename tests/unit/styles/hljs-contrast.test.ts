import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(
	resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../../src/styles/tokens.css",
	),
	"utf8",
);

// ── color math ──────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToLinearRgb(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	const full =
		h.length === 3
			? h
					.split("")
					.map((ch) => ch + ch)
					.join("")
			: h;
	const n = parseInt(full, 16);
	return [
		srgbToLinear(((n >> 16) & 255) / 255),
		srgbToLinear(((n >> 8) & 255) / 255),
		srgbToLinear((n & 255) / 255),
	];
}

// OKLCH → linear sRGB (standard OKLab matrices, Björn Ottosson).
function oklchToLinearRgb(
	l: number,
	c: number,
	hDeg: number,
): [number, number, number] {
	const hRad = (hDeg * Math.PI) / 180;
	const a = c * Math.cos(hRad);
	const b = c * Math.sin(hRad);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const clamp = (v: number) => Math.min(1, Math.max(0, v));
	return [
		clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
		clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
		clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
	];
}

function luminance(value: string): number {
	const oklch = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
	const [r, g, b] = oklch
		? oklchToLinearRgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]))
		: hexToLinearRgb(value);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
	const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

// ── tokens.css block extraction (brace-matched, tolerates nesting) ──

function themeBlock(selector: string): string {
	const start = css.indexOf(`${selector} {`);
	expect(start, `${selector} block present`).toBeGreaterThanOrEqual(0);
	let i = css.indexOf("{", start);
	const open = i;
	let depth = 0;
	for (; i < css.length; i++) {
		if (css[i] === "{") depth++;
		else if (css[i] === "}") {
			depth--;
			if (depth === 0) break;
		}
	}
	return css.slice(open + 1, i);
}

function tokenValue(block: string, name: string): string {
	const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
	expect(m, `${name} defined`).not.toBeNull();
	return m![1].trim();
}

const FG_VARS = [
	"--hljs-fg",
	"--hljs-comment",
	"--hljs-keyword",
	"--hljs-entity",
	"--hljs-constant",
	"--hljs-string",
	"--hljs-builtin",
	"--hljs-name",
	"--hljs-section",
	"--hljs-bullet",
] as const;

const THEMES = [
	":root",
	'[data-theme="light"]',
	'[data-theme="warm"]',
	'[data-theme="tui"]',
] as const;

describe("hljs token contrast (spec D17: every foreground ≥ 4.5:1)", () => {
	for (const theme of THEMES) {
		describe(theme, () => {
			const block = themeBlock(theme);
			const popover = tokenValue(block, "--popover");

			it("uses literal color values only (no var() indirection)", () => {
				for (const name of [
					...FG_VARS,
					"--hljs-addition-fg",
					"--hljs-addition-bg",
					"--hljs-deletion-fg",
					"--hljs-deletion-bg",
				]) {
					expect(tokenValue(block, name)).not.toContain("var(");
				}
			});

			for (const name of FG_VARS) {
				it(`${name} clears 4.5:1 on the code background (--popover)`, () => {
					const ratio = contrast(tokenValue(block, name), popover);
					expect(
						ratio,
						`${theme} ${name} = ${tokenValue(block, name)} on ${popover} → ${ratio.toFixed(2)}:1`,
					).toBeGreaterThanOrEqual(4.5);
				});
			}

			it("addition/deletion foregrounds clear 4.5:1 on their own backgrounds", () => {
				expect(
					contrast(
						tokenValue(block, "--hljs-addition-fg"),
						tokenValue(block, "--hljs-addition-bg"),
					),
				).toBeGreaterThanOrEqual(4.5);
				expect(
					contrast(
						tokenValue(block, "--hljs-deletion-fg"),
						tokenValue(block, "--hljs-deletion-bg"),
					),
				).toBeGreaterThanOrEqual(4.5);
			});
		});
	}
});
