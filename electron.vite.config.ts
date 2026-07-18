import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
	main: {
		// The vendored @xavier/xbp package ships TypeScript source only (its
		// exports map points at src/*.ts with no compiled JS). electron-vite's
		// default externalization would leave it as a runtime require, and
		// Electron's Node refuses to type-strip files under node_modules
		// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), crashing the main
		// process on load. Excluding it from externalization makes Vite bundle
		// and transpile its .ts at build time. Its transitive-only deps (ws,
		// qrcode-terminal) get bundled alongside; the hoisted direct deps
		// (libsodium-wrappers, zod, @ai-creed/command-contract) stay external.
		// @xterm/headless 6.0.0 is broken both ways when left external: its CJS
		// main is a UMD bundle whose named exports Node's cjs-module-lexer
		// cannot detect (an ESM `import { Terminal }` crashes the main process
		// at load), and its "module" field points at lib/xterm.mjs, a path the
		// package does not ship — the real ESM build is
		// lib-headless/xterm-headless.mjs. Alias straight to that file and
		// bundle it.
		resolve: {
			alias: {
				"@xterm/headless": fileURLToPath(
					new URL(
						"./node_modules/@xterm/headless/lib-headless/xterm-headless.mjs",
						import.meta.url,
					),
				),
			},
		},
		plugins: [
			externalizeDepsPlugin({ exclude: ["@xavier/xbp", "@xterm/headless"] }),
		],
		build: {
			rollupOptions: {
				input: {
					index: "./electron/main/index.ts",
					// Emitted as out/main/usage-worker.js; the UsageHost (bundled into
					// index.js) forks it via `new URL("./usage-worker.js", import.meta.url)`.
					"usage-worker": "./electron/main/services/usage-worker.ts",
				},
				// bufferutil/utf-8-validate are `ws`'s optional native addons. `ws`
				// is bundled transitively via @xavier/xbp; bundling these addons too
				// severs their native binding (bufferUtil.mask becomes undefined).
				// Keeping them external makes `ws` require them at runtime — using
				// the real addon when present, else falling back to pure-JS masking.
				external: ["node-pty", "bufferutil", "utf-8-validate"],
			},
		},
	},
	preload: {
		build: {
			rollupOptions: {
				input: "./electron/preload/index.ts",
				output: {
					format: "cjs",
				},
			},
		},
	},
	renderer: {
		root: ".",
		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},
		build: {
			rollupOptions: {
				input: "./index.html",
			},
		},
		plugins: [react(), tailwindcss()],
	},
});
