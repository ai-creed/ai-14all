import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		include: ["tests/perf/**/*.perf.test.ts"],
		testTimeout: 120_000,
		setupFiles: ["./tests/setup.ts"],
	},
});
