import { defineConfig } from "vitest/config";

// The two-process live bring-up gate. Unlike vitest.config.ts (jsdom, unit), this
// runs in a Node environment: the harness spawns the REAL ai-samantha headless
// connector host as a child process and drives the REAL ai-14all Samantha driver
// against it over loopback HTTP+WS. No jsdom, no electron alias — the driver and
// connector client are exercised on real `node:http`/`ws`.
export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/integration/**/*.test.ts"],
		testTimeout: 30000,
		hookTimeout: 30000,
		// Real processes + loopback ports + a shared token file: keep the files
		// serial so two spawned children never race on a port or token path.
		fileParallelism: false,
	},
});
