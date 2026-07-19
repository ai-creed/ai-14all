import type Database from "better-sqlite3";

export const TARGET_SCHEMA_VERSION = 1;

const DDL_V1 = `
CREATE TABLE observations (
  event_id        TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  source          TEXT NOT NULL,
  subject_id      TEXT,
  event_ts        INTEGER,
  ts_precision    TEXT NOT NULL,
  occurred_start  INTEGER,
  occurred_end    INTEGER,
  parser_version  INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL,
  ingested_at     INTEGER NOT NULL,
  origin          TEXT NOT NULL DEFAULT 'n/a',
  attribution_confidence REAL,
  attribution_method     TEXT,
  app_run_id           TEXT,
  terminal_session_id  TEXT,
  provider_session_id  TEXT,
  provider             TEXT,
  repo_id         TEXT,
  workspace_rel   TEXT,
  branch          TEXT,
  payload         TEXT NOT NULL
);
CREATE INDEX idx_obs_kind_ts   ON observations (kind, event_ts);
CREATE INDEX idx_obs_subject   ON observations (subject_id);
CREATE INDEX idx_obs_source_ts ON observations (source, event_ts);

CREATE TABLE coverage (
  source    TEXT NOT NULL,
  provider  TEXT NOT NULL DEFAULT 'n/a',
  day       TEXT NOT NULL,
  complete  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source, provider, day)
);

CREATE TABLE meta (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

CREATE VIEW whisper_runs AS
WITH wf AS (
  SELECT o.*,
    ROW_NUMBER() OVER (PARTITION BY o.subject_id
      ORDER BY o.event_ts DESC, o.ingested_at DESC, o.event_id DESC) AS rev
  FROM observations o WHERE o.kind = 'whisper.workflow'
),
ph AS (
  SELECT o.*, json_extract(o.payload,'$.run_id') AS run_id,
    ROW_NUMBER() OVER (PARTITION BY o.subject_id
      ORDER BY o.event_ts DESC, o.ingested_at DESC, o.event_id DESC) AS rev
  FROM observations o WHERE o.kind = 'whisper.phase'
),
ph_current AS (
  SELECT run_id, COUNT(*) AS phase_count FROM ph WHERE rev = 1 GROUP BY run_id
)
SELECT
  wf.subject_id                              AS run_id,
  json_extract(wf.payload,'$.collab_id')     AS collab_id,
  wf.repo_id, wf.workspace_rel,
  json_extract(wf.payload,'$.workflow_type') AS workflow_type,
  json_extract(wf.payload,'$.status')        AS status,
  json_extract(wf.payload,'$.halt_reason')   AS halt_reason,
  wf.occurred_start                          AS started_at,
  wf.occurred_end                            AS ended_at,
  (wf.occurred_end - wf.occurred_start)      AS duration_ms,
  COALESCE(ph_current.phase_count, 0)        AS phase_count
FROM wf
LEFT JOIN ph_current ON ph_current.run_id = wf.subject_id
WHERE wf.rev = 1;
`;

export function migrate(db: Database.Database): void {
	const current = db.pragma("user_version", { simple: true }) as number;
	if (current >= TARGET_SCHEMA_VERSION) return;
	const applyV1 = db.transaction(() => {
		db.exec(DDL_V1);
		db.pragma(`user_version = ${TARGET_SCHEMA_VERSION}`);
	});
	if (current < 1) applyV1();
}
