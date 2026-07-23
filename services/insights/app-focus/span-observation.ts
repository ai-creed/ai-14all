import type { ObservationInput } from "../store/observations.js";
import { sha256Short } from "../store/path-identity.js";
import { TARGET_SCHEMA_VERSION } from "../store/schema.js";
import type { AppSpan } from "./focus-core.js";

/** Provenance `source` for every row this collector writes (spec §5). */
export const APP_FOCUS_SOURCE = "app-focus-collector";

export const APP_FOCUS_PARSER_VERSION = 1;

// NUL separator: it cannot occur in any hashed field, so the join is unambiguous
// (same rationale as the whisper archiver's HASH_SEP).
const HASH_SEP = String.fromCharCode(0);

/**
 * Map a closed span onto the observation spine (spec §5). The content-hash
 * `event_id` is what makes at-least-once safe: an outbox replay re-sends the
 * byte-identical span, re-hashes to the same id, and the insert no-ops.
 *
 * `ingestedAt` is a placeholder — the WORKER overwrites it with its own insert
 * time, since only the worker knows when the row actually landed.
 */
export function spanToObservation(
	span: AppSpan,
	appRunId: string,
): ObservationInput {
	return {
		eventId: sha256Short(
			[span.kind, appRunId, String(span.startMs), String(span.endMs)].join(
				HASH_SEP,
			),
			24,
		),
		kind: span.kind,
		source: APP_FOCUS_SOURCE,
		subjectId: "app",
		eventTs: span.endMs,
		tsPrecision: "exact",
		occurredStart: span.startMs,
		occurredEnd: span.endMs,
		parserVersion: APP_FOCUS_PARSER_VERSION,
		schemaVersion: TARGET_SCHEMA_VERSION,
		ingestedAt: 0,
		origin: "n/a",
		appRunId,
		repoId: null,
		workspaceRel: null,
		branch: null,
		payload: { reason: span.reason },
	};
}
