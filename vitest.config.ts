import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		environment: "jsdom",
		globals: true,
		include: ["tests/unit/**/*.test.{ts,tsx}"],
		setupFiles: ["./tests/setup.ts"],
		// Unit tests run under plain Node, where importing the real `electron`
		// package throws "Electron failed to install correctly" if the binary
		// path can't be resolved (e.g. CI on Node 24). Alias it to a stub; tests
		// that assert on Electron APIs override with their own vi.mock("electron").
		alias: {
			electron: fileURLToPath(
				new URL("./tests/stubs/electron.ts", import.meta.url),
			),
		},
		// @xavier/xbp ships TypeScript sources only (no dist build). Vite does not
		// transpile node_modules by default, so we inline it so vite processes the
		// .ts files from the vendored tarball.
		server: {
			deps: {
				inline: [/@xavier\/xbp/],
			},
		},
	},
});
