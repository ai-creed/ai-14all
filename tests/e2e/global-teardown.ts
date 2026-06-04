import { execFileSync } from "node:child_process";

/**
 * Restore `better-sqlite3` to the host-node ABI after the e2e run so the unit
 * suite (`pnpm test`) keeps working regardless of invocation order. Mirrors the
 * `posttest:e2e` npm hook.
 */
export default function globalTeardown(): void {
	execFileSync("node", ["scripts/rebuild-better-sqlite3-host.mjs"], {
		stdio: "inherit",
	});
}
