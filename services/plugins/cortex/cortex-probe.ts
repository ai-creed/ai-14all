import { execFile } from "node:child_process";
import type { ProbeResult } from "../../../shared/models/ecosystem-plugin.js";
import type { ResolvedBinary } from "../binary-resolver.js";
import { adaptResolvedExec } from "../exec-resolved-binary.js";

// `ai-cortex --version` prints e.g. "ai-cortex 0.15.1". Extract the first
// semver-looking token so a leading name, a `v` prefix, or trailing build
// metadata are all tolerated.
function parseVersion(stdout: string): string | null {
	const m = stdout.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
	return m ? m[1] : null;
}

// `binary === null` means resolveBinary found nothing → not-installed. ai-cortex
// has no `env --json`; the probe is version-only. Per-worktree index-contract
// compatibility is surfaced by code-nav, not here.
export function probeCortex(
	binary: ResolvedBinary | null,
	options: { timeoutMs?: number } = {},
): Promise<ProbeResult> {
	return new Promise((resolve) => {
		if (binary === null) {
			resolve({ kind: "not-installed" });
			return;
		}
		const exec = adaptResolvedExec(binary.command, [
			...binary.prefixArgs,
			"--version",
		]);
		execFile(
			exec.command,
			exec.args,
			{ timeout: options.timeoutMs ?? 5000, maxBuffer: 1024 * 1024 },
			(error, stdout) => {
				if (error) {
					resolve({
						kind: "degraded",
						reason: "could not run `ai-cortex --version`",
					});
					return;
				}
				const version = parseVersion(String(stdout));
				if (!version) {
					resolve({
						kind: "degraded",
						reason: "`ai-cortex --version` returned unreadable output",
					});
					return;
				}
				resolve({
					kind: "installed",
					version,
					installPath: binary.command,
					protocolVersion: "",
				});
			},
		);
	});
}
