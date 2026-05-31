import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
	main: {
		build: {
			rollupOptions: {
				input: {
					index: "./electron/main/index.ts",
					// Emitted as out/main/usage-worker.js; the UsageHost (bundled into
					// index.js) forks it via `new URL("./usage-worker.js", import.meta.url)`.
					"usage-worker": "./electron/main/services/usage-worker.ts",
				},
				external: ["node-pty"],
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
		build: {
			rollupOptions: {
				input: "./index.html",
			},
		},
		plugins: [react(), tailwindcss()],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
	},
});
