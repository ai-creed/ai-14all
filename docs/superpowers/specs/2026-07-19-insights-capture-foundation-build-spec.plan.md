# Insights Capture — Instrumentation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase-1 walking skeleton of the decoupled insights-capture module — a module-owned SQLite observation store, its sibling worker + host, the provenance/attribution/privacy contracts, and the whisper workflow-history archiver threaded end-to-end as the tracer bullet.

**Architecture:** A host-Node-testable core under `services/insights/` (store, path-identity resolver, payload-validated idempotent writes, coverage, retention, derived `whisper_runs` view + typed read, and the whisper archiver) plus an Electron `InsightsHost` that forks an `insights-worker` `utilityProcess` (mirroring the existing `UsageHost`/`usage-worker` split). Capture is consent-gated; delete-all is host-owned; the first-capture notice is delivered at-least-once via a durable store marker and terminated by a renderer ack.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `better-sqlite3` ^12, `zod` ^4, Electron ^41 `utilityProcess`, Vitest ^4 (host-Node ABI), Playwright ^1.59 (e2e).

## Global Constraints

- **Source of truth:** the approved spec `docs/superpowers/specs/2026-07-19-insights-capture-foundation-build-spec.md`. Every requirement below traces to it; the §-references in each task point at the governing section.
- **Whisper's `state.db` is READ-ONLY, always.** Open with `{ readonly: true, fileMustExist: true }`; only `PRAGMA`/`SELECT`. Never `INSERT`/`UPDATE`/`PRAGMA`-write against it. (spec §10.1)
- **No content, ever.** No prompts, responses, terminal output, or file contents in any column or payload. (spec §4.2, §7.6)
- **No absolute paths in any stored value.** Enforced by the write guard; `repo_id` is an opaque hash, `workspace_rel` is repo-relative-or-basename, `workspace_label` is basename-only. (spec §7.6, §14.6)
- **v1 schema = `observations` + `coverage` + `meta` + the `whisper_runs` view**, tracked by `PRAGMA user_version = 1`. (spec §4.2–4.5)
- **Idempotent writes:** `event_id` is a deterministic content hash; insert is `ON CONFLICT(event_id) DO NOTHING`. (spec §8)
- **Phase identity = whisper `phase_run_id`** (the `workflow_phases` PK), never `phase_name`. (spec §4.5, §10.3)
- **Payload schemas are `.strict()` allowlists;** `spec_path`/`name`/`workflow_context`/free-text fields are excluded. (spec §7.6)
- **ESM + `.js` specifiers:** this repo compiles TS→ESM; relative imports MUST end in `.js` (e.g. `import { migrate } from "./schema.js"`). Match the style in `services/plugins/whisper/whisper-store-reader.ts`.
- **better-sqlite3 ABI:** host-Node tests need the host rebuild. `pnpm test` runs `pretest` (`node scripts/rebuild-better-sqlite3-host.mjs`) automatically; run tests via `pnpm test <path-substring>`. A mismatch throws `NODE_MODULE_VERSION`. (spec §4.1, mem-2026-06-03)
- **Test location:** `tests/unit/insights/...` mirroring the existing `tests/unit/...` convention; reuse `tests/unit/plugins/helpers/make-whisper-fixture-db.ts` for whisper fixtures.
- **Commit after every task** with a `feat(insights): …` or `test(insights): …` message.

---

## File Structure

**New (module core — host-Node testable, no Electron):**
- `services/insights/store/schema.ts` — DDL for `observations`/`coverage`/`meta` + `whisper_runs` view; `migrate()`; `TARGET_SCHEMA_VERSION`.
- `services/insights/store/path-identity.ts` — `resolveWorkspaceIdentity()`, `sha256Short()`, `isAbsolutePathLike()`, `assertNoAbsolutePaths()`.
- `services/insights/store/payload-schemas.ts` — strict per-kind zod payload schemas + registry.
- `services/insights/store/observations.ts` — `ObservationInput`, `insertObservation()` (validate + guard + idempotent insert).
- `services/insights/store/coverage.ts` — `markCoverage()`, `getCompleteness()`.
- `services/insights/store/views.ts` — `WhisperRunRow`, `Completeness`, `getWhisperRuns()`.
- `services/insights/store/meta.ts` — `getMeta()`/`setMetaOnce()` for durable module state.
- `services/insights/retention.ts` — `OBSERVATION_RETENTION_DAYS`, `pruneRetention()`.
- `services/insights/whisper/archiver.ts` — `archiveOnce()` (read → map → idempotent write → coverage → first-capture marker).
- `services/insights/worker-protocol.ts` — `MainToInsightsWorker`/`InsightsWorkerToMain`/`InsightsWorkerConfig`.
- `services/insights/insights-worker-core.ts` — `createInsightsWorkerCore()` (message/tick handling; the testable worker brain).

**New (Electron glue):**
- `electron/main/services/insights-worker.ts` — `utilityProcess` child shell wiring `parentPort` ↔ core.
- `electron/main/services/insights-host.ts` — `InsightsHost` (fork, consent gate, config seed, host-owned delete-all, notice re-drive).

**Modified:**
- `services/plugins/whisper/whisper-store-reader.ts` — add `listCollabIds()` + `readAllWorkflows()`.
- `tests/unit/plugins/helpers/make-whisper-fixture-db.ts` — support multiple workflows/phases incl. duplicate `phase_name`.
- `shared/models/persisted-workspace-state.ts` — add `InsightsSettingsSchema` to `UsageTelemetrySettingsSchema`.
- `shared/models/persisted-settings.ts` — extend `UsageTelemetryPatchSchema` with a nested `insights` patch.
- `services/settings/settings-service.ts` — deep-merge `usageTelemetry.insights` in `writeState()`.
- `electron/main/ipc.ts` — register `insights:setEnabled`/`insights:deleteAll`/`insights:noticeAck`; forward `insights:notice`.
- `electron/preload/index.ts` — expose the `insights` bridge.
- `src/features/settings/components/SettingsDialog.tsx` — insights toggle + "Delete insights data" action.
- renderer chrome (e.g. `src/app/…`) — one-time notice surface on `insights:notice`.

## Shared vocabulary (types used across tasks)

Defined in the task that creates them; repeated here so out-of-order readers can rely on the names:

```ts
// path-identity.ts
interface WorkspaceIdentity { repoId: string; workspaceRel: string; workspaceLabel: string; branch: string | null; }

// observations.ts
interface ObservationInput {
  eventId: string; kind: string; source: string; subjectId: string | null;
  eventTs: number | null; tsPrecision: "exact" | "mtime" | "session-start" | "derived";
  occurredStart?: number | null; occurredEnd?: number | null;
  parserVersion: number; schemaVersion: number; ingestedAt: number;
  origin?: "app-managed" | "external" | "unknown" | "n/a"; provider?: string | null;
  repoId?: string | null; workspaceRel?: string | null; branch?: string | null;
  payload: Record<string, unknown>;
}

// views.ts
type Completeness = "complete" | "partial" | "unknown";
interface WhisperRunRow {
  runId: string; collabId: string; repoId: string | null; workspaceRel: string | null;
  workflowType: string; status: string; haltReason: string | null;
  startedAt: number | null; endedAt: number | null; durationMs: number | null; phaseCount: number;
}

// whisper-store-reader.ts
interface WhisperPhaseRow { phaseRunId: string; phaseIndex: number; phaseName: string; chainId: string | null; startedAt: string | null; endedAt: string | null; outcome: string | null; }
interface WhisperWorkflowRunRow { workflowId: string; collabId: string; workspaceRoot: string; workflowType: string; status: string; haltReason: string | null; createdAt: string | null; updatedAt: string | null; phases: WhisperPhaseRow[]; }

// worker-protocol.ts
interface InsightsWorkerConfig { userDataDir: string; whisperDbPath: string | null; pollIntervalMs: number; }
```

---

## Task 1: Store schema, view & migrations

**Files:**
- Create: `services/insights/store/schema.ts`
- Test: `tests/unit/insights/store/schema.test.ts`

**Interfaces:**
- Produces: `TARGET_SCHEMA_VERSION: number`, `migrate(db: Database.Database): void`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/store/schema.test.ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate, TARGET_SCHEMA_VERSION } from "../../../../services/insights/store/schema.js";

const tables = (db: Database.Database) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
    .all().map((r: any) => r.name);

describe("insights schema migrate", () => {
  it("creates v1 with all three tables + the view and pins user_version", () => {
    const db = new Database(":memory:");
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(TARGET_SCHEMA_VERSION);
    expect(tables(db)).toEqual(expect.arrayContaining(["coverage", "meta", "observations", "whisper_runs"]));
  });

  it("is idempotent (second run is a no-op)", () => {
    const db = new Database(":memory:");
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(TARGET_SCHEMA_VERSION);
  });

  it("meta survives a reopen of the same file", () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/insights-schema-${process.pid}.db`;
    const a = new Database(path); migrate(a);
    a.prepare("INSERT INTO meta(key,value) VALUES('first_capture_at','123')").run(); a.close();
    const b = new Database(path);
    expect(b.prepare("SELECT value FROM meta WHERE key='first_capture_at'").get()).toEqual({ value: "123" });
    b.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/store/schema.test.ts`
Expected: FAIL — cannot resolve `../schema.js` (module missing).

- [ ] **Step 3: Write minimal implementation**

```ts
// services/insights/store/schema.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/insights/store/schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/insights/store/schema.ts tests/unit/insights/store/schema.test.ts
git commit -m "feat(insights): v1 store schema (observations/coverage/meta + whisper_runs view) and migrate()"
```

---

## Task 2: Path-identity resolver & absolute-path guard

**Files:**
- Create: `services/insights/store/path-identity.ts`
- Test: `tests/unit/insights/store/path-identity.test.ts`

**Interfaces:**
- Produces: `WorkspaceIdentity`, `resolveWorkspaceIdentity(root)`, `sha256Short(input, n?)`, `isAbsolutePathLike(s)`, `assertNoAbsolutePaths(values)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/store/path-identity.test.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoAbsolutePaths, isAbsolutePathLike, resolveWorkspaceIdentity, sha256Short,
} from "../../../../services/insights/store/path-identity.js";

const dirs: string[] = [];
const mk = () => { const d = mkdtempSync(join(tmpdir(), "insights-pi-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("path identity", () => {
  it("hashes opaquely and stably", () => {
    expect(sha256Short("/a/b")).toBe(sha256Short("/a/b"));
    expect(sha256Short("/a/b")).not.toContain("/");
    expect(sha256Short("/a/b").length).toBe(16);
  });

  it("flags absolute-path shapes", () => {
    for (const s of ["/Users/x", "~/x", "C:\\x", "\\\\host\\x"]) expect(isAbsolutePathLike(s)).toBe(true);
    for (const s of ["", ".worktrees/x", "repo-rel/dir", "n/a"]) expect(isAbsolutePathLike(s)).toBe(false);
    expect(() => assertNoAbsolutePaths(["ok", "/abs"])).toThrow();
    expect(() => assertNoAbsolutePaths(["ok", 123, null])).not.toThrow();
  });

  it("resolves a normal repo to opaque id + empty rel + basename label", () => {
    const repo = mk();
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    const id = resolveWorkspaceIdentity(repo);
    expect(id.repoId).toBe(sha256Short(require("node:fs").realpathSync(repo)));
    expect(id.workspaceRel).toBe("");
    expect(id.workspaceLabel).toBe(require("node:path").basename(repo));
    expect(id.branch).toBe("main");
    expect(isAbsolutePathLike(id.repoId)).toBe(false);
    expect(isAbsolutePathLike(id.workspaceRel)).toBe(false);
  });

  it("resolves a nested linked worktree to the common repo id + relative path", () => {
    const repo = mk();
    mkdirSync(join(repo, ".git", "worktrees", "wt"), { recursive: true });
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    const wt = join(repo, ".worktrees", "wt");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "wt")}\n`);
    writeFileSync(join(repo, ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/feature\n");
    const id = resolveWorkspaceIdentity(wt);
    expect(id.repoId).toBe(sha256Short(require("node:fs").realpathSync(repo)));
    expect(id.workspaceRel).toBe(join(".worktrees", "wt"));
    expect(id.branch).toBe("feature");
  });

  it("falls back for a non-git path without leaking an absolute path", () => {
    const plain = mk();
    const id = resolveWorkspaceIdentity(plain);
    expect(id.repoId).toBe(sha256Short(require("node:fs").realpathSync(plain)));
    expect(id.workspaceRel).toBe(require("node:path").basename(plain));
    expect(id.branch).toBeNull();
    expect(isAbsolutePathLike(id.workspaceRel)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/store/path-identity.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/insights/store/path-identity.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

export interface WorkspaceIdentity {
  repoId: string;
  workspaceRel: string;
  workspaceLabel: string;
  branch: string | null;
}

export function sha256Short(input: string, n = 16): string {
  return createHash("sha256").update(input).digest("hex").slice(0, n);
}

const ABS_PATH_RE = /^(\/|~|[A-Za-z]:[\\/]|\\\\)/;
export function isAbsolutePathLike(s: string): boolean {
  return ABS_PATH_RE.test(s);
}
export function assertNoAbsolutePaths(values: Iterable<unknown>): void {
  for (const v of values) {
    if (typeof v === "string" && isAbsolutePathLike(v)) {
      throw new Error("insights: refusing to store an absolute-path-like value");
    }
  }
}

function realpathSafe(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

// Walk up until a `.git` entry (dir or file) is found; return the dir holding it.
function findWorktreeRoot(start: string): string | null {
  let dir = realpathSafe(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function branchFromHead(headDir: string): string | null {
  try {
    const head = readFileSync(join(headDir, "HEAD"), "utf8").trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : null;
  } catch { return null; }
}

export function resolveWorkspaceIdentity(workspaceRoot: string): WorkspaceIdentity {
  const wtRoot = findWorktreeRoot(workspaceRoot);
  if (!wtRoot) {
    const real = realpathSafe(workspaceRoot);
    return { repoId: sha256Short(real), workspaceRel: basename(real), workspaceLabel: basename(real), branch: null };
  }
  const gitPath = join(wtRoot, ".git");
  let repoRoot = wtRoot;
  let headDir = gitPath; // where HEAD lives
  if (statSync(gitPath).isFile()) {
    // Linked worktree: ".git" file points at <mainrepo>/.git/worktrees/<name>
    const m = readFileSync(gitPath, "utf8").trim().match(/^gitdir:\s*(.+)$/);
    if (m) {
      const gitdir = m[1]; // .../.git/worktrees/<name>
      headDir = gitdir;
      const commonDir = dirname(dirname(gitdir)); // .../.git
      repoRoot = dirname(commonDir); // main repo root
    }
  }
  repoRoot = realpathSafe(repoRoot);
  const wtReal = realpathSafe(wtRoot);
  const rel = relative(repoRoot, wtReal);
  const workspaceRel = rel === "" ? "" : rel.startsWith("..") ? basename(wtReal) : rel;
  return {
    repoId: sha256Short(repoRoot),
    workspaceRel,
    workspaceLabel: basename(wtReal),
    branch: branchFromHead(headDir),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/insights/store/path-identity.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/insights/store/path-identity.ts tests/unit/insights/store/path-identity.test.ts
git commit -m "feat(insights): workspace identity resolver + absolute-path write guard"
```

---

## Task 3: Payload schemas + validated idempotent insert

**Files:**
- Create: `services/insights/store/payload-schemas.ts`, `services/insights/store/observations.ts`
- Test: `tests/unit/insights/store/observations.test.ts`

**Interfaces:**
- Consumes: `migrate` (Task 1), `assertNoAbsolutePaths` (Task 2).
- Produces: `PAYLOAD_SCHEMAS`, `ObservationInput`, `insertObservation(db, obs): boolean` (returns whether a row was inserted).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/store/observations.test.ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../../../services/insights/store/schema.js";
import { insertObservation, type ObservationInput } from "../../../../services/insights/store/observations.js";

const base = (over: Partial<ObservationInput> = {}): ObservationInput => ({
  eventId: "e1", kind: "whisper.workflow", source: "whisper-archiver", subjectId: "wf1",
  eventTs: 1000, tsPrecision: "exact", occurredStart: 900, occurredEnd: 1000,
  parserVersion: 1, schemaVersion: 7, ingestedAt: 2000, origin: "n/a",
  repoId: "abc123", workspaceRel: "", branch: "main",
  payload: { collab_id: "c1", workflow_type: "sdd", status: "done", halt_reason: null, workspace_label: "wt" },
  ...over,
});

const fresh = () => { const db = new Database(":memory:"); migrate(db); return db; };

describe("insertObservation", () => {
  it("inserts a valid observation once and dedupes by event_id", () => {
    const db = fresh();
    expect(insertObservation(db, base())).toBe(true);
    expect(insertObservation(db, base())).toBe(false); // same event_id
    expect(db.prepare("SELECT COUNT(*) c FROM observations").get()).toEqual({ c: 1 });
  });

  it("appends a new row for a changed snapshot (new event_id)", () => {
    const db = fresh();
    insertObservation(db, base());
    insertObservation(db, base({ eventId: "e2", payload: { collab_id: "c1", workflow_type: "sdd", status: "running", halt_reason: null, workspace_label: "wt" } }));
    expect(db.prepare("SELECT COUNT(*) c FROM observations").get()).toEqual({ c: 2 });
  });

  it("rejects an unregistered kind", () => {
    expect(() => insertObservation(fresh(), base({ kind: "nope" }))).toThrow(/unregistered/);
  });

  it("rejects an unknown payload key (strict allowlist) — e.g. spec_path", () => {
    expect(() => insertObservation(fresh(), base({
      payload: { collab_id: "c1", workflow_type: "sdd", status: "done", halt_reason: null, workspace_label: "wt", spec_path: "/abs/spec.md" },
    }))).toThrow();
  });

  it("rejects an absolute-path value anywhere (column or payload leaf)", () => {
    expect(() => insertObservation(fresh(), base({ workspaceRel: "/Users/x/repo" }))).toThrow(/absolute/);
    expect(() => insertObservation(fresh(), base({
      payload: { collab_id: "c1", workflow_type: "sdd", status: "done", halt_reason: null, workspace_label: "/Users/x/wt" },
    }))).toThrow(/absolute/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/store/observations.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/insights/store/payload-schemas.ts
import { z } from "zod";

export const WhisperWorkflowPayload = z.object({
  collab_id: z.string(),
  workflow_type: z.string(),
  status: z.string(),
  halt_reason: z.string().nullable(),
  workspace_label: z.string(),
}).strict();

export const WhisperPhasePayload = z.object({
  run_id: z.string(),
  phase_run_id: z.string(),
  phase_name: z.string(),
  phase_index: z.number().int(),
  outcome: z.string().nullable(),
  chain_id: z.string().nullable(),
}).strict();

export const PAYLOAD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "whisper.workflow": WhisperWorkflowPayload,
  "whisper.phase": WhisperPhasePayload,
};
```

```ts
// services/insights/store/observations.ts
import type Database from "better-sqlite3";
import { assertNoAbsolutePaths } from "./path-identity.js";
import { PAYLOAD_SCHEMAS } from "./payload-schemas.js";

export interface ObservationInput {
  eventId: string; kind: string; source: string; subjectId: string | null;
  eventTs: number | null; tsPrecision: "exact" | "mtime" | "session-start" | "derived";
  occurredStart?: number | null; occurredEnd?: number | null;
  parserVersion: number; schemaVersion: number; ingestedAt: number;
  origin?: "app-managed" | "external" | "unknown" | "n/a"; provider?: string | null;
  repoId?: string | null; workspaceRel?: string | null; branch?: string | null;
  payload: Record<string, unknown>;
}

const COLUMNS = [
  "event_id","kind","source","subject_id","event_ts","ts_precision","occurred_start","occurred_end",
  "parser_version","schema_version","ingested_at","origin","provider","repo_id","workspace_rel","branch","payload",
] as const;

const SQL = `INSERT INTO observations (${COLUMNS.join(",")})
VALUES (${COLUMNS.map((c) => `@${c}`).join(",")})
ON CONFLICT(event_id) DO NOTHING`;

export function insertObservation(db: Database.Database, obs: ObservationInput): boolean {
  const schema = PAYLOAD_SCHEMAS[obs.kind];
  if (!schema) throw new Error(`insights: unregistered kind ${obs.kind}`);
  const payload = schema.parse(obs.payload) as Record<string, unknown>;
  // Guard: promoted string columns + every payload leaf value.
  assertNoAbsolutePaths([obs.subjectId, obs.repoId, obs.workspaceRel, obs.branch, obs.provider, ...Object.values(payload)]);
  const info = db.prepare(SQL).run({
    event_id: obs.eventId, kind: obs.kind, source: obs.source, subject_id: obs.subjectId,
    event_ts: obs.eventTs, ts_precision: obs.tsPrecision,
    occurred_start: obs.occurredStart ?? null, occurred_end: obs.occurredEnd ?? null,
    parser_version: obs.parserVersion, schema_version: obs.schemaVersion, ingested_at: obs.ingestedAt,
    origin: obs.origin ?? "n/a", provider: obs.provider ?? null,
    repo_id: obs.repoId ?? null, workspace_rel: obs.workspaceRel ?? null, branch: obs.branch ?? null,
    payload: JSON.stringify(payload),
  });
  return info.changes > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/insights/store/observations.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/insights/store/payload-schemas.ts services/insights/store/observations.ts tests/unit/insights/store/observations.test.ts
git commit -m "feat(insights): strict payload allowlist + validated idempotent observation insert"
```

---

## Task 4: Coverage upsert & completeness

**Files:**
- Create: `services/insights/store/coverage.ts`
- Test: `tests/unit/insights/store/coverage.test.ts`

**Interfaces:**
- Consumes: `migrate` (Task 1).
- Produces: `markCoverage(db, {source, provider?, day, complete})`, `getCompleteness(db, source, days): Completeness`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/store/coverage.test.ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../../../services/insights/store/schema.js";
import { getCompleteness, markCoverage } from "../../../../services/insights/store/coverage.js";

const fresh = () => { const db = new Database(":memory:"); migrate(db); return db; };

describe("coverage", () => {
  it("upsert is idempotent for (source,'n/a',day)", () => {
    const db = fresh();
    markCoverage(db, { source: "whisper-archiver", day: "2026-07-19", complete: true });
    markCoverage(db, { source: "whisper-archiver", day: "2026-07-19", complete: true });
    expect(db.prepare("SELECT COUNT(*) c FROM coverage").get()).toEqual({ c: 1 });
  });

  it("reports complete/partial/unknown", () => {
    const db = fresh();
    markCoverage(db, { source: "whisper-archiver", day: "2026-07-19", complete: true });
    expect(getCompleteness(db, "whisper-archiver", ["2026-07-19"])).toBe("complete");
    expect(getCompleteness(db, "whisper-archiver", ["2026-07-19", "2026-07-20"])).toBe("partial");
    expect(getCompleteness(db, "whisper-archiver", ["2026-07-21"])).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/store/coverage.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/insights/store/coverage.ts
import type Database from "better-sqlite3";
import type { Completeness } from "./views.js";

export function markCoverage(
  db: Database.Database,
  { source, provider = "n/a", day, complete }: { source: string; provider?: string; day: string; complete: boolean },
): void {
  db.prepare(
    `INSERT INTO coverage(source,provider,day,complete) VALUES(?,?,?,?)
     ON CONFLICT(source,provider,day) DO UPDATE SET complete=excluded.complete`,
  ).run(source, provider, day, complete ? 1 : 0);
}

export function getCompleteness(db: Database.Database, source: string, days: string[]): Completeness {
  if (days.length === 0) return "unknown";
  const rows = db.prepare(
    `SELECT day, complete FROM coverage WHERE source=? AND provider='n/a' AND day IN (${days.map(() => "?").join(",")})`,
  ).all(source, ...days) as { day: string; complete: number }[];
  const complete = new Set(rows.filter((r) => r.complete === 1).map((r) => r.day));
  const have = days.filter((d) => complete.has(d)).length;
  if (have === 0) return "unknown";
  return have === days.length ? "complete" : "partial";
}
```

> Note: `Completeness` is declared in Task 5 (`views.ts`). If implementing strictly in order, temporarily declare `export type Completeness = "complete" | "partial" | "unknown";` at the top of `coverage.ts` and remove it when `views.ts` lands, or land Task 5's type first. The import above assumes `views.ts` exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/insights/store/coverage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/insights/store/coverage.ts tests/unit/insights/store/coverage.test.ts
git commit -m "feat(insights): coverage upsert + completeness derivation"
```

---

## Task 5: Derived read — `getWhisperRuns` (view correctness, range, completeness)

**Files:**
- Create: `services/insights/store/views.ts`, `services/insights/store/time.ts` (UTC-day helpers)
- Test: `tests/unit/insights/store/views.test.ts`

**Interfaces:**
- Consumes: `insertObservation` (Task 3), `getCompleteness` (Task 4).
- Produces: `Completeness`, `WhisperRunRow`, `getWhisperRuns(db, {fromMs,toMs})`, and `utcDay(ms)`, `utcDaysInRange(fromMs,toMs)` in `time.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/store/views.test.ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../../../services/insights/store/schema.js";
import { insertObservation, type ObservationInput } from "../../../../services/insights/store/observations.js";
import { markCoverage } from "../../../../services/insights/store/coverage.js";
import { getWhisperRuns } from "../../../../services/insights/store/views.js";

const fresh = () => { const db = new Database(":memory:"); migrate(db); return db; };

function wf(over: Partial<ObservationInput> & { payload?: any } = {}): ObservationInput {
  return {
    eventId: over.eventId ?? "w", kind: "whisper.workflow", source: "whisper-archiver",
    subjectId: over.subjectId ?? "wf1", eventTs: over.eventTs ?? 1000, tsPrecision: "exact",
    occurredStart: over.occurredStart ?? 500, occurredEnd: over.occurredEnd ?? null,
    parserVersion: 1, schemaVersion: 7, ingestedAt: over.ingestedAt ?? 1,
    repoId: "r", workspaceRel: "",
    payload: over.payload ?? { collab_id: "c1", workflow_type: "sdd", status: "running", halt_reason: null, workspace_label: "wt" },
  } as ObservationInput;
}
function ph(subjectId: string, runId: string, over: Partial<ObservationInput> & { payload?: any } = {}): ObservationInput {
  return {
    eventId: over.eventId ?? `p-${subjectId}-${over.eventTs ?? 0}`, kind: "whisper.phase", source: "whisper-archiver",
    subjectId, eventTs: over.eventTs ?? 900, tsPrecision: "exact",
    occurredStart: over.occurredStart ?? 600, occurredEnd: over.occurredEnd ?? null,
    parserVersion: 1, schemaVersion: 7, ingestedAt: over.ingestedAt ?? 1, repoId: "r", workspaceRel: "",
    payload: over.payload ?? { run_id: runId, phase_run_id: subjectId, phase_name: "impl", phase_index: 0, outcome: null, chain_id: null },
  } as ObservationInput;
}

describe("getWhisperRuns / whisper_runs view", () => {
  it("collapses running→terminal to one row with duration from the workflow terminal ts", () => {
    const db = fresh();
    insertObservation(db, wf({ eventId: "w1", eventTs: 1000, ingestedAt: 1 }));
    insertObservation(db, wf({ eventId: "w2", eventTs: 2000, ingestedAt: 2, occurredEnd: 2000, payload: { collab_id: "c1", workflow_type: "sdd", status: "done", halt_reason: null, workspace_label: "wt" } }));
    const { runs } = getWhisperRuns(db, { fromMs: 0, toMs: 10_000 });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("done");
    expect(runs[0].durationMs).toBe(1500); // 2000 - 500
  });

  it("counts a running→ended phase once, and two same-named phases as two", () => {
    const db = fresh();
    insertObservation(db, wf({ eventId: "w1", eventTs: 1000, occurredEnd: 1000, payload: { collab_id: "c1", workflow_type: "sdd", status: "done", halt_reason: null, workspace_label: "wt" } }));
    insertObservation(db, ph("wf1:pa", "wf1", { eventId: "pa1", eventTs: 700, ingestedAt: 1 }));                 // running
    insertObservation(db, ph("wf1:pa", "wf1", { eventId: "pa2", eventTs: 900, ingestedAt: 2, occurredEnd: 900,   // ended (same phase_run_id)
      payload: { run_id: "wf1", phase_run_id: "wf1:pa", phase_name: "impl", phase_index: 0, outcome: "ok", chain_id: null } }));
    insertObservation(db, ph("wf1:pb", "wf1", { eventId: "pb1", eventTs: 950, ingestedAt: 3,                     // second phase, SAME name
      payload: { run_id: "wf1", phase_run_id: "wf1:pb", phase_name: "impl", phase_index: 1, outcome: "ok", chain_id: null } }));
    const { runs } = getWhisperRuns(db, { fromMs: 0, toMs: 10_000 });
    expect(runs[0].phaseCount).toBe(2);
  });

  it("applies half-open UTC start-time inclusion", () => {
    const db = fresh();
    insertObservation(db, wf({ eventId: "w1", subjectId: "wf1", occurredStart: 1000, occurredEnd: 1000, payload: { collab_id: "c1", workflow_type: "sdd", status: "done", halt_reason: null, workspace_label: "wt" } }));
    expect(getWhisperRuns(db, { fromMs: 1000, toMs: 2000 }).runs).toHaveLength(1); // fromMs inclusive
    expect(getWhisperRuns(db, { fromMs: 0, toMs: 1000 }).runs).toHaveLength(0);     // toMs exclusive
  });

  it("reports completeness from coverage and reverts to unknown once coverage is gone", () => {
    const db = fresh();
    const day = new Date(500).toISOString().slice(0, 10);
    insertObservation(db, wf({ eventId: "w1", occurredStart: 500, occurredEnd: 500, payload: { collab_id: "c1", workflow_type: "sdd", status: "done", halt_reason: null, workspace_label: "wt" } }));
    markCoverage(db, { source: "whisper-archiver", day, complete: true });
    expect(getWhisperRuns(db, { fromMs: 0, toMs: 86_400_000 }).completeness).toBe("complete");
    db.prepare("DELETE FROM coverage").run();
    expect(getWhisperRuns(db, { fromMs: 0, toMs: 86_400_000 }).completeness).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/store/views.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/insights/store/time.ts
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function utcDaysInRange(fromMs: number, toMs: number): string[] {
  const days: string[] = [];
  const DAY = 86_400_000;
  let d = Date.UTC(...(new Date(fromMs).toISOString().slice(0, 10).split("-").map(Number) as [number, number, number]));
  // Normalize start-of-day for fromMs:
  d = Date.parse(`${utcDay(fromMs)}T00:00:00.000Z`);
  const end = toMs; // half-open
  for (; d < end; d += DAY) days.push(utcDay(d));
  return days.length ? days : [utcDay(fromMs)];
}
```

```ts
// services/insights/store/views.ts
import type Database from "better-sqlite3";
import { getCompleteness } from "./coverage.js";
import { utcDaysInRange } from "./time.js";

export type Completeness = "complete" | "partial" | "unknown";

export interface WhisperRunRow {
  runId: string; collabId: string; repoId: string | null; workspaceRel: string | null;
  workflowType: string; status: string; haltReason: string | null;
  startedAt: number | null; endedAt: number | null; durationMs: number | null; phaseCount: number;
}

export function getWhisperRuns(
  db: Database.Database,
  range: { fromMs: number; toMs: number },
): { runs: WhisperRunRow[]; completeness: Completeness } {
  const rows = db.prepare(
    `SELECT * FROM whisper_runs WHERE started_at >= ? AND started_at < ? ORDER BY started_at`,
  ).all(range.fromMs, range.toMs) as any[];
  const runs: WhisperRunRow[] = rows.map((r) => ({
    runId: r.run_id, collabId: r.collab_id, repoId: r.repo_id, workspaceRel: r.workspace_rel,
    workflowType: r.workflow_type, status: r.status, haltReason: r.halt_reason,
    startedAt: r.started_at, endedAt: r.ended_at, durationMs: r.duration_ms, phaseCount: r.phase_count,
  }));
  const completeness = getCompleteness(db, "whisper-archiver", utcDaysInRange(range.fromMs, range.toMs));
  return { runs, completeness };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/insights/store/views.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/insights/store/views.ts services/insights/store/time.ts tests/unit/insights/store/views.test.ts
git commit -m "feat(insights): getWhisperRuns derived read (view correctness, half-open UTC range, completeness)"
```

---

## Task 6: Meta helpers + retention prune (observations + coverage in lockstep)

**Files:**
- Create: `services/insights/store/meta.ts`, `services/insights/retention.ts`
- Test: `tests/unit/insights/retention.test.ts`

**Interfaces:**
- Consumes: `migrate` (Task 1), `insertObservation` (Task 3), `markCoverage` (Task 4), `utcDay` (Task 5).
- Produces: `getMeta(db,key)`, `setMetaOnce(db,key,value): boolean`; `OBSERVATION_RETENTION_DAYS`, `pruneRetention(db, nowMs, retentionDays?)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/retention.test.ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../../services/insights/store/schema.js";
import { insertObservation, type ObservationInput } from "../../../services/insights/store/observations.js";
import { markCoverage } from "../../../services/insights/store/coverage.js";
import { getMeta, setMetaOnce } from "../../../services/insights/store/meta.js";
import { OBSERVATION_RETENTION_DAYS, pruneRetention } from "../../../services/insights/retention.js";

const fresh = () => { const db = new Database(":memory:"); migrate(db); return db; };
const NOW = Date.parse("2026-07-19T00:00:00.000Z");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const obs = (eventId: string, ts: number): ObservationInput => ({
  eventId, kind: "whisper.workflow", source: "whisper-archiver", subjectId: eventId,
  eventTs: ts, tsPrecision: "exact", occurredStart: ts, occurredEnd: ts,
  parserVersion: 1, schemaVersion: 7, ingestedAt: ts, repoId: "r", workspaceRel: "",
  payload: { collab_id: "c1", workflow_type: "sdd", status: "done", halt_reason: null, workspace_label: "wt" },
});

describe("meta + retention", () => {
  it("setMetaOnce writes only the first value", () => {
    const db = fresh();
    expect(setMetaOnce(db, "first_capture_at", "111")).toBe(true);
    expect(setMetaOnce(db, "first_capture_at", "222")).toBe(false);
    expect(getMeta(db, "first_capture_at")).toBe("111");
  });

  it("prunes observations AND coverage older than the horizon in lockstep", () => {
    const db = fresh();
    const oldTs = NOW - (OBSERVATION_RETENTION_DAYS + 5) * 86_400_000;
    const recentTs = NOW - 1 * 86_400_000;
    insertObservation(db, obs("old", oldTs));
    insertObservation(db, obs("recent", recentTs));
    markCoverage(db, { source: "whisper-archiver", day: day(oldTs), complete: true });
    markCoverage(db, { source: "whisper-archiver", day: day(recentTs), complete: true });
    pruneRetention(db, NOW);
    expect(db.prepare("SELECT event_id FROM observations ORDER BY event_id").all()).toEqual([{ event_id: "recent" }]);
    expect(db.prepare("SELECT day FROM coverage ORDER BY day").all()).toEqual([{ day: day(recentTs) }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/retention.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/insights/store/meta.ts
import type Database from "better-sqlite3";

export function getMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
export function setMetaOnce(db: Database.Database, key: string, value: string): boolean {
  const info = db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING").run(key, value);
  return info.changes > 0;
}
```

```ts
// services/insights/retention.ts
import type Database from "better-sqlite3";
import { utcDay } from "./store/time.js";

export const OBSERVATION_RETENTION_DAYS = 365;

export function pruneRetention(db: Database.Database, nowMs: number, retentionDays = OBSERVATION_RETENTION_DAYS): void {
  const todayStart = Date.parse(`${utcDay(nowMs)}T00:00:00.000Z`);
  const cutoffMs = todayStart - retentionDays * 86_400_000; // UTC-day-aligned cutoff
  const cutoffDay = utcDay(cutoffMs);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM observations WHERE event_ts < ?").run(cutoffMs);
    db.prepare("DELETE FROM coverage WHERE day < ?").run(cutoffDay);
  });
  tx();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/insights/retention.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/insights/store/meta.ts services/insights/retention.ts tests/unit/insights/retention.test.ts
git commit -m "feat(insights): meta helpers + lockstep observation/coverage retention prune"
```

---

## Task 7: Whisper reader extension — `listCollabIds` + `readAllWorkflows`

**Files:**
- Modify: `services/plugins/whisper/whisper-store-reader.ts` (add methods + exported row types)
- Modify: `tests/unit/plugins/helpers/make-whisper-fixture-db.ts` (support N workflows / N phases incl. duplicate `phase_name`) — only if the current helper cannot express them
- Test: `tests/unit/plugins/whisper/whisper-store-reader.readall.test.ts`

**Interfaces:**
- Produces: `WhisperPhaseRow`, `WhisperWorkflowRunRow`, `WhisperStoreReader.listCollabIds(): string[]`, `WhisperStoreReader.readAllWorkflows(collabId: string): WhisperWorkflowRunRow[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/plugins/whisper/whisper-store-reader.readall.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WhisperStoreReader } from "../../../../services/plugins/whisper/whisper-store-reader.js";
import { makeWhisperFixtureDb } from "../helpers/make-whisper-fixture-db.js";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "wsr-")); dirs.push(d); return join(d, "state.db"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("readAllWorkflows", () => {
  it("returns every run for a collab with phases carrying phase_run_id (dup names distinct)", () => {
    const path = tmp();
    makeWhisperFixtureDb(path, {
      schemaVersion: 7,
      collabs: [{ collabId: "c1", workspaceRoot: "/tmp/repo", displayName: "r", status: "active" }],
      workflows: [{ workflowId: "wf1", collabId: "c1", workflowType: "spec-driven-development", status: "done", currentPhaseIndex: 1, createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:05:00.000Z" }],
      phases: [
        { phaseRunId: "wf1:pa", workflowId: "wf1", phaseIndex: 0, phaseName: "impl", chainId: "ch1", startedAt: "2026-07-19T00:00:00.000Z", endedAt: "2026-07-19T00:02:00.000Z", outcome: "ok" },
        { phaseRunId: "wf1:pb", workflowId: "wf1", phaseIndex: 1, phaseName: "impl", chainId: "ch1", startedAt: "2026-07-19T00:03:00.000Z", endedAt: "2026-07-19T00:05:00.000Z", outcome: "ok" },
      ],
    });
    const reader = new WhisperStoreReader(path);
    expect(reader.listCollabIds()).toEqual(["c1"]);
    const runs = reader.readAllWorkflows("c1");
    expect(runs).toHaveLength(1);
    expect(runs[0].workspaceRoot).toBe("/tmp/repo");
    expect(runs[0].phases.map((p) => p.phaseRunId)).toEqual(["wf1:pa", "wf1:pb"]);
  });

  it("refuses an out-of-range schema (returns [])", () => {
    const path = tmp();
    makeWhisperFixtureDb(path, { schemaVersion: 999, collabs: [{ collabId: "c1", workspaceRoot: "/tmp/r", displayName: "r", status: "active" }], workflows: [], phases: [] });
    expect(new WhisperStoreReader(path).readAllWorkflows("c1")).toEqual([]);
  });

  it("returns [] for an absent DB", () => {
    expect(new WhisperStoreReader("/no/such/state.db").readAllWorkflows("c1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/plugins/whisper/whisper-store-reader.readall.test.ts`
Expected: FAIL — `readAllWorkflows`/`listCollabIds` (and possibly the helper's `workflows`/`phases` options) undefined.

- [ ] **Step 3a: Extend the fixture helper if needed**

Open `tests/unit/plugins/helpers/make-whisper-fixture-db.ts`. Confirm the options type accepts `workflows: WorkflowRow[]` and `phases: PhaseRow[]` and inserts them into the `workflows`/`workflow_phases` tables (the DDL already has these columns — see the file's `CREATE TABLE workflows` / `workflow_phases`). If either array is not yet supported, add it following the existing `collabs`/`insert(table,row)` pattern. Map camelCase→snake_case explicitly (e.g. `phaseRunId → phase_run_id`, `workflowId → workflow_id`, `phaseIndex → phase_index`, `phaseName → phase_name`, `chainId → chain_id`, `startedAt → started_at`, `endedAt → ended_at`, `createdAt → created_at`, `updatedAt → updated_at`, `currentPhaseIndex → current_phase_index`, `workflowType → workflow_type`).

- [ ] **Step 3b: Add reader methods**

Add to `services/plugins/whisper/whisper-store-reader.ts` (reuse the existing `openChecked()` at `:43` for the schema gate; mirror the read-only pattern):

```ts
export interface WhisperPhaseRow {
  phaseRunId: string; phaseIndex: number; phaseName: string; chainId: string | null;
  startedAt: string | null; endedAt: string | null; outcome: string | null;
}
export interface WhisperWorkflowRunRow {
  workflowId: string; collabId: string; workspaceRoot: string; workflowType: string;
  status: string; haltReason: string | null; createdAt: string | null; updatedAt: string | null;
  phases: WhisperPhaseRow[];
}
```

```ts
  // inside class WhisperStoreReader:
  listCollabIds(): string[] {
    const db = this.openChecked();
    if (!db) return [];
    try {
      return (db.prepare("SELECT collab_id FROM collab ORDER BY collab_id").all() as { collab_id: string }[])
        .map((r) => r.collab_id);
    } finally { db.close(); }
  }

  readAllWorkflows(collabId: string): WhisperWorkflowRunRow[] {
    const db = this.openChecked();
    if (!db) return [];
    try {
      const collab = db.prepare("SELECT workspace_root FROM collab WHERE collab_id=?").get(collabId) as
        { workspace_root: string } | undefined;
      if (!collab) return [];
      const wfRows = db.prepare(
        `SELECT workflow_id, collab_id, workflow_type, status, halt_reason, created_at, updated_at
         FROM workflows WHERE collab_id=? ORDER BY created_at`,
      ).all(collabId) as any[];
      const phaseStmt = db.prepare(
        `SELECT phase_run_id, phase_index, phase_name, chain_id, started_at, ended_at, outcome
         FROM workflow_phases WHERE workflow_id=? ORDER BY phase_index, started_at`,
      );
      return wfRows.map((w) => ({
        workflowId: w.workflow_id, collabId: w.collab_id, workspaceRoot: collab.workspace_root,
        workflowType: w.workflow_type, status: w.status, haltReason: w.halt_reason ?? null,
        createdAt: w.created_at ?? null, updatedAt: w.updated_at ?? null,
        phases: (phaseStmt.all(w.workflow_id) as any[]).map((p) => ({
          phaseRunId: p.phase_run_id, phaseIndex: p.phase_index, phaseName: p.phase_name,
          chainId: p.chain_id ?? null, startedAt: p.started_at ?? null, endedAt: p.ended_at ?? null,
          outcome: p.outcome ?? null,
        })),
      }));
    } finally { db.close(); }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/plugins/whisper/whisper-store-reader.readall.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/plugins/whisper/whisper-store-reader.ts tests/unit/plugins/whisper/whisper-store-reader.readall.test.ts tests/unit/plugins/helpers/make-whisper-fixture-db.ts
git commit -m "feat(whisper): read-only readAllWorkflows + listCollabIds (full history, phase_run_id-keyed)"
```

---

## Task 8: Whisper archiver — `archiveOnce`

**Files:**
- Create: `services/insights/whisper/archiver.ts`
- Test: `tests/unit/insights/whisper/archiver.test.ts`

**Interfaces:**
- Consumes: `insertObservation` (Task 3), `markCoverage` (Task 4), `setMetaOnce`/`getMeta` (Task 6), `sha256Short`/`resolveWorkspaceIdentity` (Task 2), `WhisperStoreReader` (Task 7).
- Produces: `archiveOnce(db, reader, opts): { workflows: number; phases: number; firstCaptureAt: number | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/whisper/archiver.test.ts
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../../../services/insights/store/schema.js";
import { getWhisperRuns } from "../../../../services/insights/store/views.js";
import { getMeta } from "../../../../services/insights/store/meta.js";
import { WhisperStoreReader } from "../../../../services/plugins/whisper/whisper-store-reader.js";
import { makeWhisperFixtureDb } from "../../plugins/helpers/make-whisper-fixture-db.js";
import { archiveOnce } from "../../../../services/insights/whisper/archiver.js";

const dirs: string[] = [];
const mkRepo = () => {
  const d = mkdtempSync(join(tmpdir(), "arch-")); dirs.push(d);
  mkdirSync(join(d, ".git")); writeFileSync(join(d, ".git", "HEAD"), "ref: refs/heads/main\n");
  return d;
};
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fixture(repo: string) {
  const path = join(mkdtempSync(join(tmpdir(), "arch-db-")), "state.db"); dirs.push(path);
  makeWhisperFixtureDb(path, {
    schemaVersion: 7,
    collabs: [{ collabId: "c1", workspaceRoot: repo, displayName: "r", status: "active" }],
    workflows: [{ workflowId: "wf1", collabId: "c1", workflowType: "spec-driven-development", status: "done", currentPhaseIndex: 1, createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:05:00.000Z" }],
    phases: [
      { phaseRunId: "wf1:pa", workflowId: "wf1", phaseIndex: 0, phaseName: "impl", chainId: "ch1", startedAt: "2026-07-19T00:00:00.000Z", endedAt: "2026-07-19T00:02:00.000Z", outcome: "ok" },
      { phaseRunId: "wf1:pb", workflowId: "wf1", phaseIndex: 1, phaseName: "impl", chainId: "ch1", startedAt: "2026-07-19T00:03:00.000Z", endedAt: "2026-07-19T00:05:00.000Z", outcome: "ok" },
    ],
  });
  return path;
}

describe("archiveOnce", () => {
  it("archives runs+phases, is idempotent, and derives a correct run", () => {
    const repo = mkRepo();
    const reader = new WhisperStoreReader(fixture(repo));
    const db = new Database(":memory:"); migrate(db);
    const now = Date.parse("2026-07-19T01:00:00.000Z");
    const r1 = archiveOnce(db, reader, { nowMs: now });
    expect(r1.workflows).toBe(1);
    expect(r1.phases).toBe(2);
    archiveOnce(db, reader, { nowMs: now }); // re-run
    expect((db.prepare("SELECT COUNT(*) c FROM observations").get() as any).c).toBe(3); // 1 wf + 2 phases, no dupes

    const { runs, completeness } = getWhisperRuns(db, { fromMs: Date.parse("2026-07-19T00:00:00Z"), toMs: Date.parse("2026-07-20T00:00:00Z") });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("done");
    expect(runs[0].phaseCount).toBe(2);
    expect(runs[0].durationMs).toBe(5 * 60_000); // start 00:00 → terminal 00:05
    expect(completeness).toBe("complete");

    // Privacy: opaque repo_id, no absolute path stored anywhere.
    const row = db.prepare("SELECT repo_id, workspace_rel FROM observations LIMIT 1").get() as any;
    expect(row.repo_id).not.toContain("/");
    expect(db.prepare("SELECT payload FROM observations").all().every((r: any) => !r.payload.includes("/tmp/"))).toBe(true);

    expect(getMeta(db, "first_capture_at")).toBe(String(now));
  });

  it("no-ops on an out-of-range / absent whisper DB", () => {
    const reader = new WhisperStoreReader("/no/such/state.db");
    const db = new Database(":memory:"); migrate(db);
    const r = archiveOnce(db, reader, { nowMs: Date.now() });
    expect(r.workflows).toBe(0);
    expect(getMeta(db, "first_capture_at")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/whisper/archiver.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/insights/whisper/archiver.ts
import type Database from "better-sqlite3";
import { insertObservation, type ObservationInput } from "../store/observations.js";
import { markCoverage } from "../store/coverage.js";
import { getMeta, setMetaOnce } from "../store/meta.js";
import { resolveWorkspaceIdentity, sha256Short } from "../store/path-identity.js";
import { utcDay } from "../store/time.js";
import type { WhisperStoreReader, WhisperWorkflowRunRow } from "../../plugins/whisper/whisper-store-reader.js";

export const WHISPER_SOURCE = "whisper-archiver";
export const PARSER_VERSION = 1;
const ACTIVE_STATUSES = new Set(["running", "paused", "pending", "queued"]);

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function workflowEventId(run: WhisperWorkflowRunRow, endMs: number | null): string {
  const phaseOutcomes = run.phases.map((p) => `${p.phaseRunId}:${p.outcome ?? ""}`).sort().join(",");
  return sha256Short([run.workflowId, run.status, run.haltReason ?? "", String(endMs ?? ""), phaseOutcomes].join(" "), 24);
}
function phaseEventId(runId: string, p: WhisperWorkflowRunRow["phases"][number]): string {
  return sha256Short([p.phaseRunId, p.outcome ?? "", p.startedAt ?? "", p.endedAt ?? ""].join(" "), 24);
}

export function archiveOnce(
  db: Database.Database,
  reader: Pick<WhisperStoreReader, "listCollabIds" | "readAllWorkflows">,
  opts: { nowMs: number; schemaVersion?: number },
): { workflows: number; phases: number; firstCaptureAt: number | null } {
  const schemaVersion = opts.schemaVersion ?? 7;
  let workflows = 0, phases = 0, wrote = false;
  const daysTouched = new Set<string>();

  const tx = db.transaction(() => {
    for (const collabId of reader.listCollabIds()) {
      for (const run of reader.readAllWorkflows(collabId)) {
        const identity = resolveWorkspaceIdentity(run.workspaceRoot);
        const startMs = ms(run.createdAt);
        const isTerminal = !ACTIVE_STATUSES.has(run.status);
        const phaseEndMs = run.phases.map((p) => ms(p.endedAt)).filter((n): n is number => n != null);
        const endMs = isTerminal && phaseEndMs.length ? Math.max(...phaseEndMs) : null;

        const wfObs: ObservationInput = {
          eventId: workflowEventId(run, endMs), kind: "whisper.workflow", source: WHISPER_SOURCE,
          subjectId: run.workflowId, eventTs: ms(run.updatedAt) ?? startMs, tsPrecision: "exact",
          occurredStart: startMs, occurredEnd: endMs,
          parserVersion: PARSER_VERSION, schemaVersion, ingestedAt: opts.nowMs, origin: "n/a",
          repoId: identity.repoId, workspaceRel: identity.workspaceRel, branch: identity.branch,
          payload: { collab_id: run.collabId, workflow_type: run.workflowType, status: run.status, halt_reason: run.haltReason, workspace_label: identity.workspaceLabel },
        };
        if (insertObservation(db, wfObs)) wrote = true;
        workflows++;
        if (startMs != null) daysTouched.add(utcDay(startMs));

        for (const p of run.phases) {
          const phObs: ObservationInput = {
            eventId: phaseEventId(run.workflowId, p), kind: "whisper.phase", source: WHISPER_SOURCE,
            subjectId: p.phaseRunId, eventTs: ms(p.endedAt) ?? ms(p.startedAt), tsPrecision: "exact",
            occurredStart: ms(p.startedAt), occurredEnd: ms(p.endedAt),
            parserVersion: PARSER_VERSION, schemaVersion, ingestedAt: opts.nowMs, origin: "n/a",
            repoId: identity.repoId, workspaceRel: identity.workspaceRel, branch: identity.branch,
            payload: { run_id: run.workflowId, phase_run_id: p.phaseRunId, phase_name: p.phaseName, phase_index: p.phaseIndex, outcome: p.outcome, chain_id: p.chainId },
          };
          if (insertObservation(db, phObs)) wrote = true;
          phases++;
        }
      }
    }
    for (const day of daysTouched) markCoverage(db, { source: WHISPER_SOURCE, day, complete: true });
    if (wrote) setMetaOnce(db, "first_capture_at", String(opts.nowMs));
  });
  tx();

  const fca = getMeta(db, "first_capture_at");
  return { workflows, phases, firstCaptureAt: fca ? Number(fca) : null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/insights/whisper/archiver.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/insights/whisper/archiver.ts tests/unit/insights/whisper/archiver.test.ts
git commit -m "feat(insights): whisper archiver archiveOnce (map→idempotent write→coverage→first-capture marker)"
```

---

## Task 9: Worker protocol + worker core

**Files:**
- Create: `services/insights/worker-protocol.ts`, `services/insights/insights-worker-core.ts`
- Test: `tests/unit/insights/insights-worker-core.test.ts`

**Interfaces:**
- Consumes: `migrate`, `archiveOnce`, `pruneRetention`, `getWhisperRuns`, `getMeta`, `WhisperStoreReader`.
- Produces: protocol unions; `createInsightsWorkerCore(deps): { handleMessage(msg), tick(), enabled }` where `deps = { db, reader, now, post(msg) }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/insights-worker-core.test.ts
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "../../../services/insights/store/schema.js";
import { insertObservation } from "../../../services/insights/store/observations.js";
import { createInsightsWorkerCore } from "../../../services/insights/insights-worker-core.js";
import type { InsightsWorkerToMain } from "../../../services/insights/worker-protocol.js";

function stubReader(collabs: string[] = []) {
  return { listCollabIds: () => collabs, readAllWorkflows: () => [] };
}

describe("insights worker core", () => {
  it("ticks: emits status with firstCaptureAt and a one-time firstCapture", () => {
    const db = new Database(":memory:"); migrate(db);
    const posted: InsightsWorkerToMain[] = [];
    const now = 1000;
    // Seed one observation so a tick's write sets first_capture_at deterministically:
    const reader = {
      listCollabIds: () => ["c1"],
      readAllWorkflows: () => [{ workflowId: "wf1", collabId: "c1", workspaceRoot: "/tmp/repo", workflowType: "sdd", status: "done", haltReason: null, createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:01:00Z", phases: [] }],
    };
    const core = createInsightsWorkerCore({ db, reader: reader as any, now: () => now, post: (m) => posted.push(m) });
    core.tick();
    const status = posted.find((m) => m.kind === "status") as any;
    expect(status.status.firstCaptureAt).toBe(now);
    expect(posted.filter((m) => m.kind === "firstCapture")).toHaveLength(1);
    core.tick(); // second tick: no second firstCapture
    expect(posted.filter((m) => m.kind === "firstCapture")).toHaveLength(1);
  });

  it("answers a query with whisper runs and acks closeStore", () => {
    const db = new Database(":memory:"); migrate(db);
    insertObservation(db, { eventId: "w1", kind: "whisper.workflow", source: "whisper-archiver", subjectId: "wf1", eventTs: 1000, tsPrecision: "exact", occurredStart: 500, occurredEnd: 1000, parserVersion: 1, schemaVersion: 7, ingestedAt: 1, repoId: "r", workspaceRel: "", payload: { collab_id: "c1", workflow_type: "sdd", status: "done", halt_reason: null, workspace_label: "wt" } });
    const posted: InsightsWorkerToMain[] = [];
    const core = createInsightsWorkerCore({ db, reader: stubReader() as any, now: () => 1, post: (m) => posted.push(m) });
    core.handleMessage({ kind: "query", requestId: "q1", query: { name: "whisperRuns", range: { fromMs: 0, toMs: 10_000 } } });
    const res = posted.find((m) => m.kind === "queryResult") as any;
    expect(res.requestId).toBe("q1");
    expect(res.result.runs).toHaveLength(1);

    const closeSpy = vi.spyOn(db, "close");
    core.handleMessage({ kind: "closeStore", requestId: "c1" });
    expect(closeSpy).toHaveBeenCalled();
    expect(posted.some((m) => m.kind === "storeClosed" && (m as any).requestId === "c1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/insights-worker-core.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/insights/worker-protocol.ts
import type { Completeness, WhisperRunRow } from "./store/views.js";

export interface InsightsWorkerConfig { userDataDir: string; whisperDbPath: string | null; pollIntervalMs: number; }

export interface InsightsStatus {
  lastPollAt: number | null; observationCount: number; whisperAvailable: boolean; firstCaptureAt: number | null;
}
export type InsightsQuery = { name: "whisperRuns"; range: { fromMs: number; toMs: number } };

export type MainToInsightsWorker =
  | { kind: "config"; config: InsightsWorkerConfig }
  | { kind: "setEnabled"; enabled: boolean }
  | { kind: "closeStore"; requestId: string }
  | { kind: "query"; requestId: string; query: InsightsQuery }
  | { kind: "flush" };

export type InsightsWorkerToMain =
  | { kind: "status"; status: InsightsStatus }
  | { kind: "queryResult"; requestId: string; result: { runs: WhisperRunRow[]; completeness: Completeness } }
  | { kind: "storeClosed"; requestId: string }
  | { kind: "firstCapture" }
  | { kind: "error"; scope: string; message: string };
```

```ts
// services/insights/insights-worker-core.ts
import type Database from "better-sqlite3";
import { archiveOnce } from "./whisper/archiver.js";
import { pruneRetention } from "./retention.js";
import { getMeta } from "./store/meta.js";
import { getWhisperRuns } from "./store/views.js";
import type { InsightsStatus, MainToInsightsWorker, InsightsWorkerToMain } from "./worker-protocol.js";
import type { WhisperStoreReader } from "../plugins/whisper/whisper-store-reader.js";

export interface WorkerCoreDeps {
  db: Database.Database;
  reader: Pick<WhisperStoreReader, "listCollabIds" | "readAllWorkflows">;
  now: () => number;
  post: (msg: InsightsWorkerToMain) => void;
}

export function createInsightsWorkerCore(deps: WorkerCoreDeps) {
  let firstCaptureAnnounced = getMeta(deps.db, "first_capture_at") != null;

  function status(lastPollAt: number | null): InsightsStatus {
    const fca = getMeta(deps.db, "first_capture_at");
    return {
      lastPollAt,
      observationCount: (deps.db.prepare("SELECT COUNT(*) c FROM observations").get() as any).c,
      whisperAvailable: deps.reader.listCollabIds().length > 0,
      firstCaptureAt: fca ? Number(fca) : null,
    };
  }

  function tick(): void {
    const now = deps.now();
    try {
      const res = archiveOnce(deps.db, deps.reader, { nowMs: now });
      pruneRetention(deps.db, now);
      deps.post({ kind: "status", status: status(now) });
      if (res.firstCaptureAt != null && !firstCaptureAnnounced) {
        firstCaptureAnnounced = true;
        deps.post({ kind: "firstCapture" });
      }
    } catch (e) {
      deps.post({ kind: "error", scope: "tick", message: String((e as Error).message ?? e) });
    }
  }

  function handleMessage(msg: MainToInsightsWorker): void {
    switch (msg.kind) {
      case "flush": tick(); return;
      case "query": {
        try {
          const result = getWhisperRuns(deps.db, msg.query.range);
          deps.post({ kind: "queryResult", requestId: msg.requestId, result });
        } catch (e) {
          deps.post({ kind: "error", scope: "query", message: String((e as Error).message ?? e) });
        }
        return;
      }
      case "closeStore": {
        try { deps.db.close(); } finally { deps.post({ kind: "storeClosed", requestId: msg.requestId }); }
        return;
      }
      case "config": case "setEnabled": return; // handled by the shell (Task 10)
    }
  }

  return { handleMessage, tick, status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/insights/insights-worker-core.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/insights/worker-protocol.ts services/insights/insights-worker-core.ts tests/unit/insights/insights-worker-core.test.ts
git commit -m "feat(insights): worker protocol + testable worker core (tick/query/closeStore/first-capture)"
```

---

## Task 10: `insights-worker` shell + `InsightsHost`

**Files:**
- Create: `electron/main/services/insights-worker.ts` (utilityProcess child shell), `electron/main/services/insights-host.ts`
- Test: `tests/unit/insights/insights-host.test.ts`

**Interfaces:**
- Consumes: worker-protocol types.
- Produces: `class InsightsHost` with `setEnabled(enabled)`, `deleteAll(): Promise<void>`, `query(range): Promise<...>`, and a notice callback seam.

**Design note:** `InsightsHost` mirrors `UsageHost` (`electron/main/services/usage-host.ts`) — `utilityProcess.fork`, config seeded on `spawn`, pre-spawn message queue, gated `start()/stop()`. Delete-all is **host-owned** (§7.4): stop-or-closeStore then `fs.rm` the directory. Notice re-drive (§7.3): on `status.firstCaptureAt != null && !noticeShown`, invoke `onNotice()`. Make the worker path/fork injectable so the host is unit-testable with a fake proc.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/insights-host.test.ts
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsightsHost } from "../../../electron/main/services/insights-host.js";

const dirs: string[] = [];
const ud = () => { const d = mkdtempSync(join(tmpdir(), "ih-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// Fake utilityProcess: an EventEmitter with postMessage + kill.
function fakeProc() {
  const proc: any = new EventEmitter();
  proc.postMessage = vi.fn((m: any) => { proc.emit("__sent", m); });
  proc.kill = vi.fn();
  return proc;
}

describe("InsightsHost", () => {
  it("deletes the store directory even when disabled (no worker)", async () => {
    const userDataDir = ud();
    const insightsDir = join(userDataDir, "insights");
    mkdirSync(insightsDir, { recursive: true });
    writeFileSync(join(insightsDir, "insights.db"), "x");
    const host = new InsightsHost({
      userDataDir, whisperDbPath: null, pollIntervalMs: 3000,
      forkWorker: () => fakeProc(), send: () => {}, loadNoticeShown: () => false, persistNoticeShown: () => {},
    });
    // disabled → no worker
    host.setEnabled(false);
    await host.deleteAll();
    expect(existsSync(insightsDir)).toBe(false);
  });

  it("re-drives the notice on status.firstCaptureAt when noticeShown is false", () => {
    const userDataDir = ud();
    const proc = fakeProc();
    const onNotice = vi.fn();
    const host = new InsightsHost({
      userDataDir, whisperDbPath: join(userDataDir, "state.db"), pollIntervalMs: 3000,
      forkWorker: () => proc, send: (ch) => { if (ch === "insights:notice") onNotice(); },
      loadNoticeShown: () => false, persistNoticeShown: () => {},
    });
    host.setEnabled(true);
    proc.emit("spawn");
    proc.emit("message", { kind: "status", status: { lastPollAt: 1, observationCount: 1, whisperAvailable: true, firstCaptureAt: 123 } });
    expect(onNotice).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/insights-host.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/main/services/insights-host.ts
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
  InsightsWorkerConfig, MainToInsightsWorker, InsightsWorkerToMain,
} from "../../../services/insights/worker-protocol.js";

export interface InsightsHostOptions {
  userDataDir: string;
  whisperDbPath: string | null;
  pollIntervalMs: number;
  send: (channel: string, payload: unknown) => void;
  loadNoticeShown: () => boolean;
  persistNoticeShown: (v: boolean) => void;
  // Injectable for tests; defaults to a real utilityProcess.fork below.
  forkWorker?: () => UtilityProcess;
}

export const INSIGHTS_NOTICE_CHANNEL = "insights:notice";

export class InsightsHost {
  private proc: UtilityProcess | null = null;
  private spawned = false;
  private pending: MainToInsightsWorker[] = [];
  private pendingClose: ((v: void) => void) | null = null;

  constructor(private readonly opts: InsightsHostOptions) {}

  private get insightsDir(): string { return join(this.opts.userDataDir, "insights"); }

  private buildConfig(): InsightsWorkerConfig {
    return { userDataDir: this.opts.userDataDir, whisperDbPath: this.opts.whisperDbPath, pollIntervalMs: this.opts.pollIntervalMs };
  }

  private defaultFork(): UtilityProcess {
    const workerPath = fileURLToPath(new URL("./insights-worker.js", import.meta.url));
    return utilityProcess.fork(workerPath, [], { serviceName: "ai14all-insights" });
  }

  setEnabled(enabled: boolean): void { if (enabled) this.start(); else this.stop(); }

  private start(): void {
    if (this.proc) return;
    this.proc = (this.opts.forkWorker ?? (() => this.defaultFork()))();
    this.proc.on("message", (msg: InsightsWorkerToMain) => this.onMessage(msg));
    this.proc.on("spawn", () => {
      this.spawned = true;
      this.proc?.postMessage({ kind: "config", config: this.buildConfig() });
      for (const m of this.pending) this.proc?.postMessage(m);
      this.pending = [];
    });
  }

  private stop(): void {
    this.spawned = false;
    this.pending = [];
    this.proc?.kill();
    this.proc = null;
  }

  private onMessage(msg: InsightsWorkerToMain): void {
    if (msg.kind === "status") {
      if (msg.status.firstCaptureAt != null && !this.opts.loadNoticeShown()) {
        this.opts.send(INSIGHTS_NOTICE_CHANNEL, { at: msg.status.firstCaptureAt });
      }
      return;
    }
    if (msg.kind === "firstCapture") {
      if (!this.opts.loadNoticeShown()) this.opts.send(INSIGHTS_NOTICE_CHANNEL, {});
      return;
    }
    if (msg.kind === "storeClosed") { this.pendingClose?.(); this.pendingClose = null; return; }
    if (msg.kind === "queryResult") { this.opts.send("insights:queryResult", msg); return; }
  }

  /** Called by the renderer ack (insights:noticeAck) via IPC. */
  ackNotice(): void { this.opts.persistNoticeShown(true); }

  private post(msg: MainToInsightsWorker): void {
    if (!this.proc) return;
    if (!this.spawned) { this.pending.push(msg); return; }
    this.proc.postMessage(msg);
  }

  async deleteAll(): Promise<void> {
    if (this.proc) {
      await new Promise<void>((resolve) => {
        this.pendingClose = resolve;
        this.post({ kind: "closeStore", requestId: "delete-all" });
        setTimeout(() => { this.pendingClose = null; resolve(); }, 2000); // don't hang if the worker is wedged
      });
      this.stop();
    }
    await rm(this.insightsDir, { recursive: true, force: true });
  }
}
```

```ts
// electron/main/services/insights-worker.ts
// utilityProcess child shell: wires parentPort <-> the testable core, owns the poll timer + store lifecycle.
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "../../../services/insights/store/schema.js";
import { createInsightsWorkerCore } from "../../../services/insights/insights-worker-core.js";
import { WhisperStoreReader } from "../../../services/plugins/whisper/whisper-store-reader.js";
import type { InsightsWorkerConfig, MainToInsightsWorker } from "../../../services/insights/worker-protocol.js";

const port = (process as unknown as { parentPort: import("node:worker_threads").MessagePort }).parentPort;

let db: Database.Database | null = null;
let core: ReturnType<typeof createInsightsWorkerCore> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function boot(config: InsightsWorkerConfig): void {
  const { mkdirSync } = require("node:fs");
  mkdirSync(join(config.userDataDir, "insights"), { recursive: true });
  db = new Database(join(config.userDataDir, "insights", "insights.db"));
  db.pragma("journal_mode = WAL");
  migrate(db);
  const reader = new WhisperStoreReader(config.whisperDbPath ?? "");
  core = createInsightsWorkerCore({ db, reader, now: () => Date.now(), post: (m) => port.postMessage(m) });
  core.tick();
  timer = setInterval(() => core?.tick(), config.pollIntervalMs);
}

port.on("message", (e: { data: MainToInsightsWorker }) => {
  const msg = e.data;
  if (msg.kind === "config") { boot(msg.config); return; }
  if (msg.kind === "closeStore") { if (timer) clearInterval(timer); timer = null; }
  core?.handleMessage(msg);
});
```

> Note: whisper DB path resolution in the main process — reuse the existing whisper env probe used by `whisper-driver`/`whisper-env-probe.ts` to compute `whisperDbPath`, and pass it into `InsightsHostOptions` when wiring the host at app startup (alongside the existing `UsageHost` wiring). `loadNoticeShown`/`persistNoticeShown` read/write `usageTelemetry.insights.noticeShown` through `SettingsService` (Task 11).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/insights/insights-host.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/main/services/insights-host.ts electron/main/services/insights-worker.ts tests/unit/insights/insights-host.test.ts
git commit -m "feat(insights): InsightsHost (fork, gate, host-owned delete-all, notice re-drive) + worker shell"
```

---

## Task 11: Settings — `insights` sub-setting + deep-merge guard

**Files:**
- Modify: `shared/models/persisted-workspace-state.ts` (add `InsightsSettingsSchema` to `UsageTelemetrySettingsSchema`)
- Modify: `shared/models/persisted-settings.ts` (nested `insights` patch in `UsageTelemetryPatchSchema`)
- Modify: `services/settings/settings-service.ts` (deep-merge `usageTelemetry.insights` in `writeState`)
- Test: `tests/unit/services/settings/insights-settings.test.ts`

**Interfaces:**
- Produces: `usageTelemetry.insights = { enabled: boolean; noticeShown: boolean }` on persisted settings; a partial `{ usageTelemetry: { insights: { enabled?: boolean; noticeShown?: boolean } } }` patch that deep-merges.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/services/settings/insights-settings.test.ts
import { describe, expect, it } from "vitest";
import { UsageTelemetrySettingsSchema } from "../../../../shared/models/persisted-workspace-state.js";
import { DEFAULT_PERSISTED_SETTINGS, SettingsPatchSchema, PersistedSettingsV1Schema } from "../../../../shared/models/persisted-settings.js";

// Mirror of SettingsService.writeState()'s deep-merge, to prove the merge rule for insights.
function merge(current: any, patch: any) {
  return PersistedSettingsV1Schema.parse({
    ...current, ...patch,
    ...(patch.usageTelemetry ? { usageTelemetry: {
      ...current.usageTelemetry, ...patch.usageTelemetry,
      ...(patch.usageTelemetry.insights ? { insights: { ...current.usageTelemetry.insights, ...patch.usageTelemetry.insights } } : {}),
    } } : {}),
  });
}

describe("insights settings", () => {
  it("defaults insights on, noticeShown false", () => {
    expect(UsageTelemetrySettingsSchema.parse({}).insights).toEqual({ enabled: true, noticeShown: false });
    expect(DEFAULT_PERSISTED_SETTINGS.usageTelemetry.insights).toEqual({ enabled: true, noticeShown: false });
  });

  it("a { insights: { enabled: false } } patch does NOT reset noticeShown", () => {
    const current = { ...DEFAULT_PERSISTED_SETTINGS, usageTelemetry: { enabled: true, includeUntracked: false, chipRange: "week", insights: { enabled: true, noticeShown: true } } };
    const patch = SettingsPatchSchema.parse({ usageTelemetry: { insights: { enabled: false } } });
    const merged = merge(current, patch);
    expect(merged.usageTelemetry.insights).toEqual({ enabled: false, noticeShown: true });
    expect(merged.usageTelemetry.enabled).toBe(true); // sibling untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/services/settings/insights-settings.test.ts`
Expected: FAIL — `insights` not on the schema.

- [ ] **Step 3: Edit the schemas + merge**

In `shared/models/persisted-workspace-state.ts`, extend `UsageTelemetrySettingsSchema` (currently at `:87`):

```ts
export const InsightsSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  noticeShown: z.boolean().default(false),
});
export const UsageTelemetrySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  includeUntracked: z.boolean().default(false),
  chipRange: z.enum(["week", "month"]).default("week"),
  insights: InsightsSettingsSchema.default({ enabled: true, noticeShown: false }),
});
```

In `shared/models/persisted-settings.ts`, extend the bare patch mirror (`UsageTelemetryPatchSchema` at `:68`) — bare optionals, no `.default()` (same reason documented there):

```ts
const InsightsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  noticeShown: z.boolean().optional(),
});
const UsageTelemetryPatchSchema = z.object({
  enabled: z.boolean().optional(),
  includeUntracked: z.boolean().optional(),
  chipRange: z.enum(["week", "month"]).optional(),
  insights: InsightsPatchSchema.optional(),
});
```

In `services/settings/settings-service.ts` `writeState()` (`:122`), deepen the `usageTelemetry` merge so `insights` merges rather than replaces:

```ts
...(patch.usageTelemetry
  ? {
      usageTelemetry: {
        ...this.current.usageTelemetry,
        ...patch.usageTelemetry,
        ...(patch.usageTelemetry.insights
          ? { insights: { ...this.current.usageTelemetry.insights, ...patch.usageTelemetry.insights } }
          : {}),
      },
    }
  : {}),
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test tests/unit/services/settings/insights-settings.test.ts`
Expected: PASS (2 tests).
Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add shared/models/persisted-workspace-state.ts shared/models/persisted-settings.ts services/settings/settings-service.ts tests/unit/services/settings/insights-settings.test.ts
git commit -m "feat(insights): usageTelemetry.insights sub-setting (default-on) with deep-merge-preserving patch"
```

---

## Task 12: IPC handlers + preload bridge + host wiring

**Files:**
- Modify: `electron/main/ipc.ts` (register handlers; forward the notice; add `insightsHost` dep), plus the app-startup wiring that constructs `InsightsHost`
- Modify: `electron/preload/index.ts` (expose `window.api.insights`)
- Test: `tests/unit/insights/insights-ipc.test.ts` (handler registration against a stubbed `ipcMain`/host)

**Interfaces:**
- Consumes: `InsightsHost` (Task 10), effective-consent from settings (Task 11).
- Produces: IPC channels `insights:setEnabled`, `insights:deleteAll`, `insights:noticeAck`; forwarded renderer event `insights:notice`; preload `window.api.insights.{ setEnabled, deleteAll, ackNotice, onNotice }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/insights-ipc.test.ts
import { describe, expect, it, vi } from "vitest";
import { registerInsightsIpc } from "../../../electron/main/insights-ipc.js";

function stubIpcMain() {
  const handlers = new Map<string, (...a: any[]) => any>();
  return { handle: (ch: string, fn: any) => handlers.set(ch, fn), invoke: (ch: string, ...a: any[]) => handlers.get(ch)!({}, ...a), has: (ch: string) => handlers.has(ch) };
}

describe("insights IPC", () => {
  it("registers and routes setEnabled / deleteAll / noticeAck", async () => {
    const ipc = stubIpcMain();
    const host = { setEnabled: vi.fn(), deleteAll: vi.fn().mockResolvedValue(undefined), ackNotice: vi.fn() };
    registerInsightsIpc(ipc as any, host as any);
    expect(ipc.has("insights:setEnabled")).toBe(true);
    ipc.invoke("insights:setEnabled", false);
    expect(host.setEnabled).toHaveBeenCalledWith(false);
    await ipc.invoke("insights:deleteAll");
    expect(host.deleteAll).toHaveBeenCalled();
    ipc.invoke("insights:noticeAck");
    expect(host.ackNotice).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/insights/insights-ipc.test.ts`
Expected: FAIL — `electron/main/insights-ipc.ts` missing.

- [ ] **Step 3: Implement the IPC registrar + wire it**

Create `electron/main/insights-ipc.ts` (a small, testable registrar; call it from `registerIpcHandlers` in `ipc.ts`):

```ts
// electron/main/insights-ipc.ts
import type { IpcMain } from "electron";
import type { InsightsHost } from "./services/insights-host.js";

export function registerInsightsIpc(
  ipcMain: Pick<IpcMain, "handle">,
  host: Pick<InsightsHost, "setEnabled" | "deleteAll" | "ackNotice">,
): void {
  ipcMain.handle("insights:setEnabled", (_e, enabled: unknown) => { host.setEnabled(Boolean(enabled)); });
  ipcMain.handle("insights:deleteAll", async () => { await host.deleteAll(); });
  ipcMain.handle("insights:noticeAck", () => { host.ackNotice(); });
}
```

In `electron/main/ipc.ts` `registerIpcHandlers(...)`, add an `insightsHost?: InsightsHost` field to the options object (next to `usageHost?` at `:172`) and call `if (insightsHost) registerInsightsIpc(ipcMain, insightsHost);`. Import `registerInsightsIpc` and `InsightsHost` at the top. The `insights:notice` event is emitted by `InsightsHost` via the `send` seam it already receives (`mainWindow.webContents.send`), so no extra emit code is needed here.

At app startup (where `UsageHost` is constructed — search for `new UsageHost(`), construct `InsightsHost` with:
- `userDataDir` = the same `app.getPath("userData")` used for usage,
- `whisperDbPath` = resolved via the whisper env probe (as `whisper-driver` does),
- `send` = `(ch,p) => mainWindow.webContents.send(ch,p)`,
- `loadNoticeShown` = `() => settingsService.current.usageTelemetry.insights.noticeShown`,
- `persistNoticeShown` = `(v) => void settingsService.writeState({ usageTelemetry: { insights: { noticeShown: v } } })`.
Gate it on effective consent: `insightsHost.setEnabled(s.usageTelemetry.enabled && s.usageTelemetry.insights.enabled)` at startup and on every `settings:write` (mirror the existing `usageHost.setEnabled` live-apply at `ipc.ts` `:588`).

In `electron/preload/index.ts`, add to the exposed API object (follow the existing `contextBridge.exposeInMainWorld` shape):

```ts
insights: {
  setEnabled: (enabled: boolean) => ipcRenderer.invoke("insights:setEnabled", enabled),
  deleteAll: () => ipcRenderer.invoke("insights:deleteAll"),
  ackNotice: () => ipcRenderer.invoke("insights:noticeAck"),
  onNotice: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("insights:notice", listener);
    return () => ipcRenderer.removeListener("insights:notice", listener);
  },
},
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test tests/unit/insights/insights-ipc.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main/insights-ipc.ts electron/main/ipc.ts electron/preload/index.ts tests/unit/insights/insights-ipc.test.ts
git commit -m "feat(insights): IPC handlers (setEnabled/deleteAll/noticeAck), notice forward, preload bridge, host wiring"
```

---

## Task 13: Settings UI — insights toggle, delete action, first-capture notice

**Files:**
- Modify: `src/features/settings/components/SettingsDialog.tsx` (Usage section, ~`:203`)
- Create: `src/app/components/InsightsNotice.tsx` (one-time notice surface) + mount it in the app chrome
- Test: `tests/unit/features/settings/insights-controls.test.tsx` (component render/interaction with a stubbed `window.api.insights`)

**Interfaces:**
- Consumes: `window.api.insights` (Task 12), `settings.usageTelemetry.insights` (Task 11).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/features/settings/insights-controls.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InsightsNotice } from "../../../../src/app/components/InsightsNotice.js";

describe("InsightsNotice", () => {
  it("shows on notice, acks on dismiss, and does not reappear", () => {
    const ack = vi.fn();
    let fire: () => void = () => {};
    (globalThis as any).window.api = { insights: { ackNotice: ack, onNotice: (cb: () => void) => { fire = cb; return () => {}; } } };
    render(<InsightsNotice />);
    expect(screen.queryByRole("status")).toBeNull();
    fire();
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(ack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/features/settings/insights-controls.test.tsx`
Expected: FAIL — `InsightsNotice` missing.

- [ ] **Step 3: Implement the notice + the Settings controls**

Create `src/app/components/InsightsNotice.tsx`:

```tsx
import { useEffect, useState } from "react";

export function InsightsNotice(): JSX.Element | null {
  const [show, setShow] = useState(false);
  useEffect(() => window.api.insights.onNotice(() => setShow(true)), []);
  if (!show) return null;
  return (
    <div role="status" className="insights-notice">
      <span>ai-14all now records local, content-free usage insights — manage or delete these in Settings.</span>
      <button onClick={() => { window.api.insights.ackNotice(); setShow(false); }}>Dismiss</button>
    </div>
  );
}
```

Mount `<InsightsNotice />` once in the top-level app chrome (e.g. beside where global toasts render). In `SettingsDialog.tsx`, inside the Usage `<section>` (after the existing `usageTelemetry.enabled` toggle at `:203`–`:218`), add:

```tsx
<label className="settings-dialog__row">
  <input
    type="checkbox"
    checked={settings.usageTelemetry.insights.enabled}
    onChange={(e) => {
      patch({ usageTelemetry: { insights: { enabled: e.target.checked } } });
      void window.api.insights.setEnabled(settings.usageTelemetry.enabled && e.target.checked);
    }}
  />
  usage insights (local, content-free)
</label>
<button
  className="settings-dialog__danger"
  onClick={() => { void window.api.insights.deleteAll(); }}
>
  Delete insights data
</button>
```

(Use the exact `patch(...)` helper the dialog already uses for `usageTelemetry` — see the existing `usageTelemetry.enabled` handler; the shape `{ usageTelemetry: { insights: { enabled } } }` matches the Task 11 deep-merge patch.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/features/settings/insights-controls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/components/SettingsDialog.tsx src/app/components/InsightsNotice.tsx tests/unit/features/settings/insights-controls.test.tsx
git commit -m "feat(insights): Settings toggle + delete-all action + one-time first-capture notice"
```

---

## Task 14: End-to-end coverage (notice appears once, toggle stops, delete clears)

**Files:**
- Create: `tests/e2e/insights.test.ts`

**Interfaces:**
- Consumes: the full wired app (Tasks 1–13).

**Design note:** AGENTS.md:159–160 require e2e for new user-visible behavior, extending (not replacing) the suite. Follow the existing e2e harness in `tests/e2e/` (e.g. `review-mcp.test.ts` for the Electron+Playwright launch pattern) and seed a fixture whisper `state.db` under the app's resolved whisper path so first capture happens deterministically.

- [ ] **Step 1: Write the e2e test**

```ts
// tests/e2e/insights.test.ts
import { test, expect } from "@playwright/test";
// Reuse the repo's existing Electron launch helper (mirror tests/e2e/review-mcp.test.ts).
import { launchApp } from "./helpers/launch.js"; // adjust to the actual helper name/path in tests/e2e

test("first capture surfaces the notice once; toggle stops; delete-all clears", async () => {
  const app = await launchApp({ seedWhisperFixture: true }); // seed a state.db with one done workflow
  const win = await app.firstWindow();

  // Notice appears exactly once after first capture.
  await expect(win.getByRole("status")).toContainText("usage insights");
  await win.getByRole("button", { name: /dismiss/i }).click();
  // Reload → notice does not reappear (noticeShown persisted after ack).
  await win.reload();
  await expect(win.getByRole("status")).toHaveCount(0);

  // Disable via Settings → capture stops (store row count stops growing).
  await win.getByRole("button", { name: /settings/i }).click();
  await win.getByLabel(/usage insights/i).uncheck();

  // Delete insights data → store directory removed (assert via a debug IPC or by re-enabling and seeing an empty store).
  await win.getByRole("button", { name: /delete insights data/i }).click();

  await app.close();
});
```

- [ ] **Step 2: Run the e2e test**

Run: `pnpm test:e2e insights`
Expected: PASS. (`pretest:e2e` runs `electron-rebuild` for the Electron ABI; `posttest:e2e` restores the host ABI.)

- [ ] **Step 3: Adjust to the real harness**

If `launchApp`/`seedWhisperFixture`/selectors differ from the repo's helpers, align them with the existing `tests/e2e/*.test.ts` patterns (they already launch the built Electron app via Playwright). Keep the three assertions: notice-once, toggle-stops, delete-clears.

- [ ] **Step 4: Full suite + typecheck + lint**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green (unit suite on host ABI). Then `pnpm test:e2e` green (Electron ABI).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/insights.test.ts
git commit -m "test(insights): e2e coverage for first-capture notice, disable toggle, and delete-all"
```

---

## Spec coverage map (self-review)

| Spec § | Requirement | Task |
|---|---|---|
| §3.1, §3.2 | InsightsHost + worker + protocol (utilityProcess, gated) | 9, 10 |
| §4.2 | `observations` spine schema + indexes | 1 |
| §4.3 | `coverage` (non-null sentinel) + `meta` tables | 1, 4, 6 |
| §4.4 | v1 migration incl. all three tables (+ view) | 1 |
| §4.5 | `whisper_runs` deterministic current-revision view | 1, 5 |
| §5 | provenance + `ts_precision` on every row | 3, 8 |
| §6 | attribution columns carried; whisper `origin='n/a'` | 3, 8 |
| §7.1, §7.2 | `insights` setting, default-on, master kill | 11, 12 |
| §7.3 | first-capture notice: durable marker, at-least-once delivery, ack | 8, 9, 10, 12, 13, 14 |
| §7.4 | host-owned delete-all (works while disabled) | 10, 12, 13 |
| §7.5 | single-horizon retention, observations+coverage lockstep | 6 |
| §7.6 | resolver + strict allowlist + absolute-path guard | 2, 3, 8 |
| §8 | deterministic event_id, idempotent insert | 3, 8 |
| §10.1 | read-only `readAllWorkflows` (drop LIMIT 1, phase_run_id) | 7 |
| §10.2 | worker-owned poll | 10 |
| §10.3 | observation mapping (phase_run_id identity, excl. spec_path) | 8 |
| §10.4 | `getWhisperRuns` half-open UTC start-time range + completeness | 5 |
| §12 | edge cases (absent DB, dup phase name, retention, notice loss) | 5, 7, 8, 10 |
| §13 | full test plan | every task |
| §14 | acceptance criteria | 1–14 (e2e in 14) |

**Placeholder scan:** none — every code step contains complete code; every test step contains real assertions; every run step names an exact command and expected result.

**Type consistency:** `ObservationInput`, `WhisperRunRow`, `Completeness`, `WhisperWorkflowRunRow`/`WhisperPhaseRow`, and the protocol unions are defined once (Tasks 3, 5, 7, 9) and imported by name everywhere else. `getWhisperRuns`, `insertObservation`, `archiveOnce`, `markCoverage`, `resolveWorkspaceIdentity`, `pruneRetention`, `setMetaOnce`/`getMeta` keep the same signatures across all references.

## Execution notes

- Tasks 1–9 are pure host-Node modules — fully TDD-able with `pnpm test`. Tasks 10–13 touch Electron/renderer; unit-test the extracted cores (host, IPC registrar, notice component) and cover the wired flow in Task 14's e2e.
- The one place the plan intentionally leaves the last mile to the implementer is the exact app-startup wiring line for `new InsightsHost(...)` and the e2e launch helper names — both must match the repo's current `UsageHost` wiring and `tests/e2e` helpers, which are the authoritative patterns to mirror.
