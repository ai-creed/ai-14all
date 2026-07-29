import type Database from "better-sqlite3";
import type { CoverageAnchorsResult } from "../worker-protocol.js";
import { getMeta } from "./meta.js";

// `CoverageAnchorsResult` is declared ONCE, in worker-protocol.ts (Task 4) —
// it is the wire type. Re-exported here so callers can import it beside
// getCoverageAnchors.
export type { CoverageAnchorsResult };

// Leftmost seek on idx_obs_kind_occstart (schema v3). MIN ignores NULL
// occurred_start rows — exactly the rows the range predicates also exclude
// (spec §4.5: anchors match visibility, never event_ts).
function minOccurredStart(db: Database.Database, kind: string): number | null {
	const row = db
		.prepare("SELECT MIN(occurred_start) AS m FROM observations WHERE kind = ?")
		.get(kind) as { m: number | null };
	return row.m;
}

const APP_KINDS = ["app.focused", "app.engaged", "app.uptime"] as const;

export function getCoverageAnchors(
	db: Database.Database,
): CoverageAnchorsResult {
	const appMins = APP_KINDS.map((k) => minOccurredStart(db, k)).filter(
		(v): v is number => v !== null,
	);
	const fca = getMeta(db, "first_capture_at");
	return {
		firstCaptureAt: fca ? Number(fca) : null,
		appRetainedSinceMs: appMins.length ? Math.min(...appMins) : null,
		runsRetainedSinceMs: minOccurredStart(db, "whisper.workflow"),
	};
}
