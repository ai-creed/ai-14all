import type Database from "better-sqlite3";
import { markCoverage } from "../store/coverage.js";
import { getMeta, setMetaOnce } from "../store/meta.js";
import {
	insertObservation,
	type ObservationInput,
} from "../store/observations.js";
import {
	resolveWorkspaceIdentity,
	sha256Short,
} from "../store/path-identity.js";
import { utcDay } from "../store/time.js";
import type {
	WhisperStoreReader,
	WhisperWorkflowRunRow,
} from "../../plugins/whisper/whisper-store-reader.js";

export const WHISPER_SOURCE = "whisper-archiver";
export const PARSER_VERSION = 1;

// Statuses whisper uses for a run that has NOT reached a terminal state. A run
// in any of these is still in flight, so its window has no end yet.
const ACTIVE_STATUSES = new Set(["running", "paused", "pending", "queued"]);

// Field separator for content-hash inputs: a NUL byte can't occur in any of the
// hashed text fields, so it delimits them unambiguously (a plain space could let
// "a b" + "c" collide with "a" + "b c" when a field carries an embedded space).
const HASH_SEP = String.fromCharCode(0);

function ms(iso: string | null): number | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? null : t;
}

// Content-hash the fields that define a run's *observable state* so an unchanged
// run re-hashes to the same event_id (idempotent no-op via ON CONFLICT), while a
// real change (new status/halt/terminal-ts/phase outcome) mints a new id that is
// appended and wins in the whisper_runs view's latest-revision projection.
function workflowEventId(
	run: WhisperWorkflowRunRow,
	endMs: number | null,
): string {
	const phaseOutcomes = run.phases
		.map((p) => `${p.phaseRunId}:${p.outcome ?? ""}`)
		.sort()
		.join(",");
	return sha256Short(
		[
			run.workflowId,
			run.status,
			run.haltReason ?? "",
			String(endMs ?? ""),
			phaseOutcomes,
		].join(HASH_SEP),
		24,
	);
}

function phaseEventId(p: WhisperWorkflowRunRow["phases"][number]): string {
	return sha256Short(
		[p.phaseRunId, p.outcome ?? "", p.startedAt ?? "", p.endedAt ?? ""].join(
			HASH_SEP,
		),
		24,
	);
}

/**
 * Read whisper's full workflow history and archive it into the insights store:
 * one `whisper.workflow` observation per run + one `whisper.phase` per phase,
 * with deterministic content-hash event_ids (idempotent re-runs), resolved
 * opaque workspace identity, per-day coverage marking, and a once-only
 * `first_capture_at` meta marker — all in a single transaction.
 */
export function archiveOnce(
	db: Database.Database,
	reader: Pick<
		WhisperStoreReader,
		"listCollabIds" | "readAllWorkflows" | "readSchemaVersion"
	>,
	opts: { nowMs: number },
): { workflows: number; phases: number; firstCaptureAt: number | null } {
	// Provenance: stamp each row with the SOURCE DB's real user_version, never a
	// hardcoded default — a supported v6 whisper DB must be recorded as v6, not v7.
	const schemaVersion = reader.readSchemaVersion() ?? 0;
	let workflows = 0;
	let phases = 0;
	let wrote = false;
	const daysTouched = new Set<string>();

	const tx = db.transaction(() => {
		for (const collabId of reader.listCollabIds()) {
			for (const run of reader.readAllWorkflows(collabId)) {
				const identity = resolveWorkspaceIdentity(run.workspaceRoot);
				const startMs = ms(run.createdAt);
				const isTerminal = !ACTIVE_STATUSES.has(run.status);
				const phaseEndMs = run.phases
					.map((p) => ms(p.endedAt))
					.filter((n): n is number => n != null);
				// End the window only once terminal, from the last phase to finish;
				// while running the window stays open (NULL end).
				const endMs =
					isTerminal && phaseEndMs.length ? Math.max(...phaseEndMs) : null;

				const wfObs: ObservationInput = {
					eventId: workflowEventId(run, endMs),
					kind: "whisper.workflow",
					source: WHISPER_SOURCE,
					subjectId: run.workflowId,
					eventTs: ms(run.updatedAt) ?? startMs,
					tsPrecision: "exact",
					occurredStart: startMs,
					occurredEnd: endMs,
					parserVersion: PARSER_VERSION,
					schemaVersion,
					ingestedAt: opts.nowMs,
					origin: "n/a",
					repoId: identity.repoId,
					workspaceRel: identity.workspaceRel,
					branch: identity.branch,
					payload: {
						collab_id: run.collabId,
						workflow_type: run.workflowType,
						status: run.status,
						halt_reason: run.haltReason,
						workspace_label: identity.workspaceLabel,
					},
				};
				if (insertObservation(db, wfObs)) wrote = true;
				workflows++;
				if (startMs != null) daysTouched.add(utcDay(startMs));

				for (const p of run.phases) {
					const phObs: ObservationInput = {
						eventId: phaseEventId(p),
						kind: "whisper.phase",
						source: WHISPER_SOURCE,
						subjectId: p.phaseRunId,
						eventTs: ms(p.endedAt) ?? ms(p.startedAt),
						tsPrecision: "exact",
						occurredStart: ms(p.startedAt),
						occurredEnd: ms(p.endedAt),
						parserVersion: PARSER_VERSION,
						schemaVersion,
						ingestedAt: opts.nowMs,
						origin: "n/a",
						repoId: identity.repoId,
						workspaceRel: identity.workspaceRel,
						branch: identity.branch,
						payload: {
							run_id: run.workflowId,
							phase_run_id: p.phaseRunId,
							phase_name: p.phaseName,
							phase_index: p.phaseIndex,
							outcome: p.outcome,
							chain_id: p.chainId,
						},
					};
					if (insertObservation(db, phObs)) wrote = true;
					phases++;
				}
			}
		}
		for (const day of daysTouched)
			markCoverage(db, { source: WHISPER_SOURCE, day, complete: true });
		// Once-only, inside the same transaction as the writes it marks.
		if (wrote) setMetaOnce(db, "first_capture_at", String(opts.nowMs));
	});
	tx();

	const fca = getMeta(db, "first_capture_at");
	return { workflows, phases, firstCaptureAt: fca ? Number(fca) : null };
}
