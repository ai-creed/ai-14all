#!/usr/bin/env node
/**
 * CSS architecture guard (spec §7, docs/shared/styling-architecture.md).
 * Assumes prettier-formatted CSS (prettier runs in CI): a rule's `{` ends the
 * selector's final line, `}` stands alone on its line, and declarations end
 * with `;`. Selectors may wrap across ANY number of lines in any prettier
 * shape (trailing-comma lists, bare wrapped-compound prefix lines like a
 * standalone `[data-theme="tui"]`, deep `:is(...)` wrapping) — every
 * non-declaration line is accumulated as selector text until the `{`.
 * Declaration values may also wrap (e.g. long font stacks); they are
 * consumed to their terminating `;` so value fragments never pollute the
 * selector accumulator.
 *
 * Invariants:
 *  1. [data-theme] rules only in tokens.css, or under the TOP-LEVEL
 *     @layer app.themes — a NESTED app.themes (e.g. inside app.components)
 *     is the css-cascade-5 pitfall and is rejected.
 *  2. base.css / modules/*.css: no top-level rules outside @layer blocks;
 *     only allowed layer names (base.css: app.base/app.themes; modules:
 *     app.components/app.themes); no nested @layer; no @layer statements.
 *  3. index.css: layer(...) imports validated on the PARSED import target —
 *     only `@import "./hljs-tokens.css" layer(app.components);` passes.
 *  4. A custom property declared in any [data-theme] block anywhere is a
 *     theme token: all its declarations must live in tokens.css AND it must
 *     have a tokens.css :root default (spec §4.1/§4.2 rule 1).
 *  5. (warn) module files should stay under 800 lines.
 *
 * An embedded adversarial self-test runs FIRST on every invocation (exit 2
 * on failure), so a regression in this guard itself fails `pnpm lint`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LAYER_NAMES = {
	base: new Set(["app.base", "app.themes"]),
	module: new Set(["app.components", "app.themes"]),
};

/** Blank out comments, preserving line structure (kills the
 * `layer(...) ; / * hljs-tokens.css * /` spoof before any line matching). */
function stripComments(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** Scan one CSS source. kind: "tokens" | "base" | "module" | "plain". */
function scan(src, kind) {
	const lines = stripComments(src).split("\n");
	const out = {
		lineCount: lines.length,
		themeVars: [], // --name declared under any [data-theme] rule
		otherVars: [], // --name declared anywhere else
		rootVars: [], // --name declared in a top-level :root rule
		errors: [],
	};
	const stack = []; // frames: { layer: string|null, theme: bool, root: bool }
	let pending = ""; // selector text accumulated until the opening "{"
	let pendingDecl = false; // inside a multi-line declaration value

	const inTheme = () => stack.some((f) => f.theme);
	const layerPath = () =>
		stack
			.filter((f) => f.layer)
			.map((f) => f.layer)
			.join(".");

	for (let i = 0; i < lines.length; i++) {
		const n = i + 1;
		const line = lines[i].trim();
		if (!line) continue;

		// Consume the remainder of a wrapped declaration value first — its
		// fragments (often ending in ",") must never reach the selector
		// accumulator.
		if (pendingDecl) {
			if (line.endsWith(";")) pendingDecl = false;
			continue;
		}

		if (line === "}") {
			stack.pop();
			pending = "";
			continue;
		}

		if (line.endsWith("{")) {
			// Multiline selector lists accumulate in `pending` until the `{`.
			const selector = `${pending} ${line.slice(0, -1)}`.trim();
			pending = "";
			const layerMatch = selector.match(/^@layer\s+([A-Za-z0-9_.-]+)$/);
			const frame = {
				layer: layerMatch ? layerMatch[1] : null,
				theme: selector.includes("[data-theme"),
				root: stack.length === 0 && /^:root\b/.test(selector),
			};

			if (layerMatch && (kind === "base" || kind === "module")) {
				if (stack.some((f) => f.layer)) {
					out.errors.push(
						`line ${n}: nested @layer ${frame.layer} (css-cascade-5 pitfall — app layers must be top-level siblings)`,
					);
				} else if (!LAYER_NAMES[kind].has(frame.layer)) {
					out.errors.push(
						`line ${n}: @layer ${frame.layer} is not allowed in a ${kind} file (allowed: ${[...LAYER_NAMES[kind]].join(", ")})`,
					);
				}
			}

			if (
				!layerMatch &&
				stack.length === 0 &&
				(kind === "base" || kind === "module")
			) {
				out.errors.push(
					`line ${n}: top-level rule outside @layer blocks: ${selector.slice(0, 60)}`,
				);
			}

			stack.push(frame);

			if (frame.theme && kind !== "tokens") {
				// The FULL layer path must be exactly the top-level app.themes.
				if (layerPath() !== "app.themes") {
					out.errors.push(
						`line ${n}: [data-theme] rule outside top-level @layer app.themes (layer path: "${layerPath() || "<unlayered>"}"): ${selector.slice(0, 60)}`,
					);
				}
			}
			continue;
		}

		if (line.startsWith("@layer") && line.endsWith(";")) {
			if (kind === "base" || kind === "module") {
				out.errors.push(
					`line ${n}: @layer order statement belongs in index.css only`,
				);
			}
			continue;
		}

		// Other at-statements (@import, @charset, @custom-variant, …) are not
		// selector fragments.
		if (line.startsWith("@") && line.endsWith(";")) continue;

		// Declaration start: (custom) property name, colon, then a space or
		// line end — prettier's two shapes. Selector fragments never match:
		// ":root" starts with the colon, "a:hover" has no space after it.
		const declStart = line.match(/^(--[A-Za-z0-9-]+|[A-Za-z-]+):(\s|$)/);
		if (declStart && stack.length > 0) {
			if (!line.endsWith(";")) pendingDecl = true;
			if (declStart[1].startsWith("--")) {
				const entry = { name: declStart[1], line: n };
				if (inTheme()) out.themeVars.push(entry);
				else out.otherVars.push(entry);
				if (stack.some((f) => f.root) && !inTheme()) {
					out.rootVars.push(entry);
				}
			}
			continue;
		}

		// Everything else is a selector fragment: trailing-comma list lines
		// AND bare wrapped-compound lines (standalone `[data-theme="tui"]`
		// prefix, `.child` continuation, `:is(` wrapping). Keep ALL of it
		// until the opening "{".
		pending += ` ${line}`;
	}
	return out;
}

/** Validate index.css imports on parsed targets, never raw line text. */
function checkIndex(src) {
	const errors = [];
	const lines = stripComments(src).split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line.startsWith("@import")) continue;
		const m = line.match(
			/^@import\s+(?:url\()?["']([^"']+)["']\)?\s*(?:layer\(\s*([A-Za-z0-9_.-]+)\s*\))?\s*;$/,
		);
		if (!m) {
			errors.push(`index.css:${i + 1} unparseable @import: ${line}`);
			continue;
		}
		const [, target, layer] = m;
		if (layer !== undefined) {
			if (target !== "./hljs-tokens.css" || layer !== "app.components") {
				errors.push(
					`index.css:${i + 1} layer(...) import is only allowed as @import "./hljs-tokens.css" layer(app.components) — got target "${target}", layer "${layer}" (nested-layer pitfall)`,
				);
			}
		}
	}
	return errors;
}

/** files: [{ path, kind, src }], kind as in scan() plus "index". */
function checkRepo(files) {
	const errors = [];
	const warnings = [];
	const scans = new Map();
	for (const f of files) {
		if (f.kind === "index") {
			errors.push(...checkIndex(f.src));
			continue;
		}
		const r = scan(f.src, f.kind);
		scans.set(f.path, { ...r, kind: f.kind });
		errors.push(...r.errors.map((e) => `${f.path}: ${e}`));
	}

	// Invariant 4: theme-token locality + required :root defaults.
	const themeTokenNames = new Set(
		[...scans.values()].flatMap((r) => r.themeVars.map((v) => v.name)),
	);
	const tokensScan = [...scans.values()].find((r) => r.kind === "tokens");
	const rootDefaults = new Set(
		tokensScan ? tokensScan.rootVars.map((v) => v.name) : [],
	);
	for (const name of themeTokenNames) {
		if (!rootDefaults.has(name)) {
			errors.push(
				`${name} is declared in a [data-theme] block but has no :root default in tokens.css (spec §4.1/§4.2 rule 1)`,
			);
		}
	}
	for (const [path, r] of scans) {
		if (r.kind === "tokens") continue;
		for (const v of [...r.themeVars, ...r.otherVars]) {
			if (themeTokenNames.has(v.name)) {
				errors.push(
					`${path}:${v.line} theme-varying custom property ${v.name} declared outside tokens.css`,
				);
			}
		}
	}

	// Invariant 5: module size (warn only).
	for (const [path, r] of scans) {
		if (r.kind === "module" && r.lineCount > 800) {
			warnings.push(`${path} is ${r.lineCount} lines (soft cap 800)`);
		}
	}
	return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Self-test: adversarial fixtures (the reviewer-demonstrated false negatives
// and one clean case). Runs before every real scan.
// ---------------------------------------------------------------------------
const GOOD_TOKENS =
	':root {\n\t--sha-color: #a78bfa;\n\t--cell-w: 1ch;\n}\n[data-theme="tui"] {\n\t--sha-color: #fff;\n\t--cell-w: 2ch;\n}\n';

const SELF_TESTS = [
	{
		name: "multiline [data-theme] selector inside app.components is flagged",
		files: [
			{ path: "tokens.css", kind: "tokens", src: GOOD_TOKENS },
			{
				path: "modules/x.css",
				kind: "module",
				src: '@layer app.components {\n\t[data-theme="tui"] .a,\n\t[data-theme="tui"] .b {\n\t\tcolor: red;\n\t}\n}\n',
			},
		],
		expect: /outside top-level @layer app\.themes/,
	},
	{
		// The reviewer-demonstrated bypass: prettier wraps a long compound
		// selector at the combinator, leaving [data-theme="tui"] alone on its
		// line with NO trailing comma (production form: src/styles/tui.css
		// lines 84-85 and 139-146).
		name: "standalone [data-theme] prefix line (wrapped compound) is flagged",
		files: [
			{ path: "tokens.css", kind: "tokens", src: GOOD_TOKENS },
			{
				path: "modules/x.css",
				kind: "module",
				src: '@layer app.components {\n\t[data-theme="tui"]\n\t\t.shell-x[data-attention="actionRequired"]::before {\n\t\tcolor: red;\n\t}\n}\n',
			},
		],
		expect: /outside top-level @layer app\.themes/,
	},
	{
		name: "nested app.themes inside app.components is flagged",
		files: [
			{ path: "tokens.css", kind: "tokens", src: GOOD_TOKENS },
			{
				path: "modules/x.css",
				kind: "module",
				src: '@layer app.components {\n\t@layer app.themes {\n\t\t[data-theme="tui"] .a {\n\t\t\tcolor: red;\n\t\t}\n\t}\n}\n',
			},
		],
		expect: /nested @layer/,
	},
	{
		name: "layered module import flagged despite hljs mention in a comment",
		files: [
			{
				path: "index.css",
				kind: "index",
				src: '@import "./modules/sidebar.css" layer(app.components); /* hljs-tokens.css */\n',
			},
		],
		expect: /layer\(\.\.\.\) import is only allowed/,
	},
	{
		name: "unknown layer name in a module is flagged",
		files: [
			{ path: "tokens.css", kind: "tokens", src: GOOD_TOKENS },
			{
				path: "modules/x.css",
				kind: "module",
				src: "@layer unexpected {\n\t.a {\n\t\tcolor: red;\n\t}\n}\n",
			},
		],
		expect: /not allowed in a module file/,
	},
	{
		name: "theme token without a :root default is flagged",
		files: [
			{
				path: "tokens.css",
				kind: "tokens",
				src: ':root {\n\t--sha-color: #a78bfa;\n}\n[data-theme="tui"] {\n\t--orphan: red;\n}\n',
			},
		],
		expect:
			/--orphan is declared in a \[data-theme\] block but has no :root default/,
	},
	{
		name: "theme token declared outside tokens.css is flagged",
		files: [
			{ path: "tokens.css", kind: "tokens", src: GOOD_TOKENS },
			{
				path: "base.css",
				kind: "base",
				src: "@layer app.base {\n\t:root {\n\t\t--sha-color: red;\n\t}\n}\n",
			},
		],
		expect: /--sha-color declared outside tokens\.css/,
	},
	{
		name: "top-level rule outside @layer in a module is flagged",
		files: [
			{ path: "tokens.css", kind: "tokens", src: GOOD_TOKENS },
			{
				path: "modules/x.css",
				kind: "module",
				src: ".a {\n\tcolor: red;\n}\n",
			},
		],
		expect: /top-level rule outside @layer/,
	},
	{
		// Clean case doubles as the false-positive guard: wrapped declaration
		// values (@font-face src, long font stacks) must not pollute the
		// selector accumulator, and a deep-wrapped :is() compound in
		// app.themes must pass.
		name: "clean base + module + index pass (incl. wrapped values/selectors)",
		files: [
			{ path: "tokens.css", kind: "tokens", src: GOOD_TOKENS },
			{
				path: "index.css",
				kind: "index",
				src: '@layer theme, base, components, utilities, app.base, app.components, app.themes;\n@import "./tokens.css";\n@import "./base.css";\n@import "./modules/x.css";\n@import "./hljs-tokens.css" layer(app.components);\n',
			},
			{
				path: "base.css",
				kind: "base",
				src: '@layer app.base {\n\t@font-face {\n\t\tfont-family: "X";\n\t\tsrc: url("./x.ttf")\n\t\t\tformat("truetype");\n\t}\n\t:root {\n\t\t--font-ui:\n\t\t\t"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Monaco, monospace;\n\t\tfont-family: var(--font-ui);\n\t}\n}\n',
			},
			{
				path: "modules/x.css",
				kind: "module",
				src: '@layer app.components {\n\t.a {\n\t\tcolor: var(--sha-color);\n\t}\n}\n\n@layer app.themes {\n\t[data-theme="tui"] .a {\n\t\tborder: none;\n\t}\n\t[data-theme="tui"]\n\t\t.b\n\t\t:is(\n\t\t\t.c,\n\t\t\t.d\n\t\t) {\n\t\topacity: 0.6;\n\t}\n}\n',
			},
		],
		expect: null,
	},
];

let selfTestFailed = false;
for (const t of SELF_TESTS) {
	const { errors } = checkRepo(t.files);
	const ok =
		t.expect === null
			? errors.length === 0
			: errors.some((e) => t.expect.test(e));
	if (!ok) {
		selfTestFailed = true;
		console.error(`SELF-TEST FAIL: ${t.name}`);
		console.error(`  expected: ${t.expect ?? "no errors"}`);
		console.error(`  got: ${errors.length ? errors.join(" | ") : "no errors"}`);
	}
}
if (selfTestFailed) {
	console.error("check-css-architecture: self-test failed — fix the guard.");
	process.exit(2);
}

// ---------------------------------------------------------------------------
// Real tree.
// ---------------------------------------------------------------------------
const STYLES = "src/styles";
const files = [
	{ path: join(STYLES, "tokens.css"), kind: "tokens" },
	{ path: join(STYLES, "index.css"), kind: "index" },
	{ path: join(STYLES, "hljs-tokens.css"), kind: "plain" },
	{ path: join(STYLES, "base.css"), kind: "base" },
	...readdirSync(join(STYLES, "modules"))
		.filter((f) => f.endsWith(".css"))
		.map((f) => ({ path: join(STYLES, "modules", f), kind: "module" })),
].map((f) => ({ ...f, src: readFileSync(f.path, "utf8") }));

const { errors, warnings } = checkRepo(files);
for (const w of warnings) console.warn(`WARN  ${w}`);
if (errors.length > 0) {
	for (const e of errors) console.error(`ERROR ${e}`);
	console.error(`\ncheck-css-architecture: ${errors.length} error(s).`);
	process.exit(1);
}
console.log("check-css-architecture: OK");
