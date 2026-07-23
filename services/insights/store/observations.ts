import type Database from "better-sqlite3";
import { assertNoAbsolutePathsDeep } from "./path-identity.js";
import { PAYLOAD_SCHEMAS } from "./payload-schemas.js";

export interface ObservationInput {
	eventId: string;
	kind: string;
	source: string;
	subjectId: string | null;
	eventTs: number | null;
	tsPrecision: "exact" | "mtime" | "session-start" | "derived";
	occurredStart?: number | null;
	occurredEnd?: number | null;
	parserVersion: number;
	schemaVersion: number;
	ingestedAt: number;
	origin?: "app-managed" | "external" | "unknown" | "n/a";
	/** Opaque per-app-launch id for live collectors (§5). Never a path. */
	appRunId?: string | null;
	provider?: string | null;
	repoId?: string | null;
	workspaceRel?: string | null;
	branch?: string | null;
	payload: Record<string, unknown>;
}

const COLUMNS = [
	"event_id",
	"kind",
	"source",
	"subject_id",
	"event_ts",
	"ts_precision",
	"occurred_start",
	"occurred_end",
	"parser_version",
	"schema_version",
	"ingested_at",
	"origin",
	"app_run_id",
	"provider",
	"repo_id",
	"workspace_rel",
	"branch",
	"payload",
] as const;

const SQL = `INSERT INTO observations (${COLUMNS.join(",")})
VALUES (${COLUMNS.map((c) => `@${c}`).join(",")})
ON CONFLICT(event_id) DO NOTHING`;

export function insertObservation(
	db: Database.Database,
	obs: ObservationInput,
): boolean {
	const schema = PAYLOAD_SCHEMAS[obs.kind];
	if (!schema) throw new Error(`insights: unregistered kind ${obs.kind}`);
	const payload = schema.parse(obs.payload) as Record<string, unknown>;
	// Guard EVERY persisted value: all promoted string columns AND every payload leaf
	// (recursively). Passing `payload` as an object makes the deep walk cover nested leaves;
	// eventId/source/tsPrecision/origin are included because they are persisted too.
	assertNoAbsolutePathsDeep([
		obs.eventId,
		obs.kind,
		obs.source,
		obs.subjectId,
		obs.tsPrecision,
		obs.origin ?? "n/a",
		obs.appRunId ?? null,
		obs.provider ?? null,
		obs.repoId,
		obs.workspaceRel,
		obs.branch,
		payload,
	]);
	const info = db.prepare(SQL).run({
		event_id: obs.eventId,
		kind: obs.kind,
		source: obs.source,
		subject_id: obs.subjectId,
		event_ts: obs.eventTs,
		ts_precision: obs.tsPrecision,
		occurred_start: obs.occurredStart ?? null,
		occurred_end: obs.occurredEnd ?? null,
		parser_version: obs.parserVersion,
		schema_version: obs.schemaVersion,
		ingested_at: obs.ingestedAt,
		origin: obs.origin ?? "n/a",
		app_run_id: obs.appRunId ?? null,
		provider: obs.provider ?? null,
		repo_id: obs.repoId ?? null,
		workspace_rel: obs.workspaceRel ?? null,
		branch: obs.branch ?? null,
		payload: JSON.stringify(payload),
	});
	return info.changes > 0;
}
