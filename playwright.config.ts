import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	// Ensure the Electron-ABI better-sqlite3 the app needs is built before any
	// `playwright test` run (direct or via `pnpm test:e2e`), and restore the
	// host ABI afterwards so `pnpm test` keeps working. Mirrors the
	// pre/posttest:e2e npm hooks so the suite is self-sufficient.
	globalSetup: "./tests/e2e/global-setup.ts",
	globalTeardown: "./tests/e2e/global-teardown.ts",
	timeout: 60_000,
	expect: {
		timeout: 10_000,
		toHaveScreenshot: {
			// Tiny AA tolerance for same-machine reruns; anything visible fails.
			maxDiffPixels: 64,
			// Spec §6.1 requires animations disabled. Playwright's default is
			// "allow" (playwright-core types.d.ts) — set it explicitly so every
			// assertion in every suite gets deterministic, settled frames.
			animations: "disabled",
		},
	},
	fullyParallel: false,
	workers: 1,
	// CI's slower, loaded runners surface timing flakes the local run doesn't, so
	// give CI an extra attempt. Local stays at 1 retry so real failures still
	// surface promptly rather than being masked by retries.
	retries: process.env.CI ? 2 : 1,
});
