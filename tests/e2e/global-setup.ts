import { execFileSync } from "node:child_process";

/**
 * The Electron app loads `better-sqlite3` at Electron's native ABI, but the
 * unit-test workflow leaves it built for the host-node ABI. Rebuild it for
 * Electron before launching the app so a direct `playwright test` invocation is
 * self-sufficient — without this the app cannot open any SQLite store and
 * code-nav throws `CortexIndexNotReadyError`. Mirrors the `pretest:e2e` npm
 * hook; `global-teardown.ts` restores the host ABI so `pnpm test` keeps working.
 */
export default function globalSetup(): void {
	execFileSync(
		"./node_modules/.bin/electron-rebuild",
		["-f", "-w", "better-sqlite3"],
		{ stdio: "inherit" },
	);
}
