import { execFile } from "node:child_process";
import { z } from "zod";
import type { ProbeResult } from "../../../shared/models/ecosystem-plugin.js";
import type { ResolvedBinary } from "../binary-resolver.js";
import { adaptResolvedExec } from "../exec-resolved-binary.js";

// v7 (whisper 0.12.x) only added the duo_roll/duo_assignment tables; every
// table and column in the read contract that we consume is unchanged from v6.
export const SUPPORTED_DB_SCHEMA = { min: 6, max: 7 };

const WhisperEnvReportSchema = z.object({
	engineVersion: z.string(),
	installPath: z.string(),
	stateRoot: z.string(),
	dbSchemaVersion: z.number(),
	protocolVersion: z.string(),
	// Optional: only whisper builds shipping the evaluator-readiness field emit
	// it. Older engines parse fine and we simply surface no warning.
	evaluator: z.object({ ready: z.boolean(), status: z.string() }).optional(),
});

export function probeWhisper(
	binary: ResolvedBinary,
	options: { timeoutMs?: number } = {},
): Promise<ProbeResult> {
	return new Promise((resolve) => {
		const exec = adaptResolvedExec(binary.command, [
			...binary.prefixArgs,
			"env",
			"--json",
		]);
		execFile(
			exec.command,
			exec.args,
			{ timeout: options.timeoutMs ?? 5000, maxBuffer: 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					// A whisper that exists but predates `env` answers with a
					// commander unknown-command error — that is "upgrade whisper",
					// not "not installed".
					if (/unknown command/i.test(`${stderr}${stdout}`)) {
						resolve({
							kind: "incompatible",
							found: "pre-env whisper",
							required: "whisper with `env --json` support",
						});
						return;
					}
					// The binary resolved but would not run (failed to exec — e.g. a
					// missing `node` interpreter for the shebang — or timed out). It is
					// present, just unusable: degraded, not absent.
					resolve({
						kind: "degraded",
						reason: "could not run `whisper env --json`",
					});
					return;
				}
				let parsed: unknown;
				try {
					parsed = JSON.parse(stdout);
				} catch {
					resolve({
						kind: "degraded",
						reason: "`whisper env --json` returned unreadable output",
					});
					return;
				}
				const report = WhisperEnvReportSchema.safeParse(parsed);
				if (!report.success) {
					resolve({
						kind: "degraded",
						reason: "`whisper env --json` returned unreadable output",
					});
					return;
				}
				const schema = report.data.dbSchemaVersion;
				if (schema > SUPPORTED_DB_SCHEMA.max) {
					resolve({
						kind: "incompatible",
						found: `db schema ${schema}`,
						required: `db schema ${SUPPORTED_DB_SCHEMA.max} (update ai-14all)`,
					});
					return;
				}
				if (schema < SUPPORTED_DB_SCHEMA.min) {
					resolve({
						kind: "incompatible",
						found: `db schema ${schema}`,
						required: `db schema ${SUPPORTED_DB_SCHEMA.min} (upgrade whisper)`,
					});
					return;
				}
				resolve({
					kind: "installed",
					version: report.data.engineVersion,
					installPath: report.data.installPath,
					protocolVersion: report.data.protocolVersion,
					// Spread only when present so the result has no `evaluator` key for
					// older whisper builds (the panel then shows no warning).
					...(report.data.evaluator
						? { evaluator: report.data.evaluator }
						: {}),
				});
			},
		);
	});
}
