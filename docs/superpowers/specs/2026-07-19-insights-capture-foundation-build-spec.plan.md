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
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoAbsolutePaths, assertNoAbsolutePathsDeep, isAbsolutePathLike, resolveWorkspaceIdentity, sha256Short,
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
    // Recursive guard: catches an absolute path nested in an object/array.
    expect(() => assertNoAbsolutePathsDeep({ a: { b: ["ok", "/Users/x"] } })).toThrow();
    expect(() => assertNoAbsolutePathsDeep({ a: { b: ["ok", "rel/dir"] }, c: 1, d: null })).not.toThrow();
  });

  it("resolves a normal repo to opaque id + empty rel + basename label", () => {
    const repo = mk();
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    const id = resolveWorkspaceIdentity(repo);
    expect(id.repoId).toBe(sha256Short(realpathSync(repo)));
    expect(id.workspaceRel).toBe("");
    expect(id.workspaceLabel).toBe(basename(repo));
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
    expect(id.repoId).toBe(sha256Short(realpathSync(repo)));
    expect(id.workspaceRel).toBe(join(".worktrees", "wt"));
    expect(id.branch).toBe("feature");
  });

  it("falls back for a non-git path without leaking an absolute path", () => {
    const plain = mk();
    const id = resolveWorkspaceIdentity(plain);
    expect(id.repoId).toBe(sha256Short(realpathSync(plain)));
    expect(id.workspaceRel).toBe(basename(plain));
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
// Recursive: walks strings, arrays, and nested objects so no persisted leaf escapes the guard.
export function assertNoAbsolutePathsDeep(value: unknown): void {
  if (typeof value === "string") {
    if (isAbsolutePathLike(value)) throw new Error("insights: refusing to store an absolute-path-like value");
    return;
  }
  if (Array.isArray(value)) { for (const v of value) assertNoAbsolutePathsDeep(v); return; }
  if (value && typeof value === "object") { for (const v of Object.values(value)) assertNoAbsolutePathsDeep(v); return; }
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

  it("rejects an absolute-path value in ANY persisted field (eventId/source/column/payload leaf)", () => {
    expect(() => insertObservation(fresh(), base({ eventId: "/abs/evt" }))).toThrow(/absolute/);
    expect(() => insertObservation(fresh(), base({ source: "/abs/src" }))).toThrow(/absolute/);
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
import { assertNoAbsolutePathsDeep } from "./path-identity.js";
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
  // Guard EVERY persisted value: all promoted string columns AND every payload leaf
  // (recursively). Passing `payload` as an object makes the deep walk cover nested leaves;
  // eventId/source/tsPrecision/origin are included because they are persisted too.
  assertNoAbsolutePathsDeep([
    obs.eventId, obs.kind, obs.source, obs.subjectId, obs.tsPrecision, obs.origin ?? "n/a",
    obs.provider ?? null, obs.repoId, obs.workspaceRel, obs.branch, payload,
  ]);
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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { WhisperStoreReader } from "../../../../services/plugins/whisper/whisper-store-reader.js";
import { makeWhisperFixtureDb } from "../helpers/make-whisper-fixture-db.js";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "wsr-")); dirs.push(d); return join(d, "state.db"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// Read-only introspection helpers for the "source unchanged" regression test.
const version = (p: string) => { const d = new Database(p, { readonly: true }); const v = d.pragma("user_version", { simple: true }); d.close(); return v; };
const dump = (p: string) => {
  const d = new Database(p, { readonly: true });
  const r = { collab: d.prepare("SELECT * FROM collab ORDER BY collab_id").all(), workflows: d.prepare("SELECT * FROM workflows ORDER BY workflow_id").all(), phases: d.prepare("SELECT * FROM workflow_phases ORDER BY phase_run_id").all() };
  d.close();
  return r;
};

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

  it("never writes to the source DB (user_version, rows, and file bytes unchanged after reads)", () => {
    const path = tmp();
    makeWhisperFixtureDb(path, {
      schemaVersion: 7,
      collabs: [{ collabId: "c1", workspaceRoot: "/tmp/repo", displayName: "r", status: "active" }],
      workflows: [{ workflowId: "wf1", collabId: "c1", workflowType: "spec-driven-development", status: "done", currentPhaseIndex: 0, createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:01:00.000Z" }],
      phases: [{ phaseRunId: "wf1:pa", workflowId: "wf1", phaseIndex: 0, phaseName: "impl", chainId: "ch1", startedAt: "2026-07-19T00:00:00.000Z", endedAt: "2026-07-19T00:01:00.000Z", outcome: "ok" }],
    });
    const before = { v: version(path), rows: dump(path), bytes: readFileSync(path) };
    const reader = new WhisperStoreReader(path);
    reader.listCollabIds();
    reader.readAllWorkflows("c1");
    reader.readAllWorkflows("c1"); // repeat — still no writes
    const after = { v: version(path), rows: dump(path), bytes: readFileSync(path) };
    expect(after.v).toBe(before.v);
    expect(after.rows).toEqual(before.rows);
    expect(after.bytes.equals(before.bytes)).toBe(true); // byte-identical main file: readonly open, no journal/WAL write
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

  it("stamps rows with the source DB's real user_version (v6, not a hardcoded default)", () => {
    const repo = mkRepo();
    const path = join(mkdtempSync(join(tmpdir(), "arch-v6-")), "state.db"); dirs.push(path);
    makeWhisperFixtureDb(path, {
      schemaVersion: 6,
      collabs: [{ collabId: "c1", workspaceRoot: repo, displayName: "r", status: "active" }],
      workflows: [{ workflowId: "wf1", collabId: "c1", workflowType: "spec-driven-development", status: "done", currentPhaseIndex: 0, createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:01:00.000Z" }],
      phases: [{ phaseRunId: "wf1:pa", workflowId: "wf1", phaseIndex: 0, phaseName: "impl", chainId: "ch1", startedAt: "2026-07-19T00:00:00.000Z", endedAt: "2026-07-19T00:01:00.000Z", outcome: "ok" }],
    });
    const db = new Database(":memory:"); migrate(db);
    archiveOnce(db, new WhisperStoreReader(path), { nowMs: Date.parse("2026-07-19T01:00:00.000Z") });
    expect(db.prepare("SELECT DISTINCT schema_version FROM observations").all()).toEqual([{ schema_version: 6 }]);
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
  return sha256Short([run.workflowId, run.status, run.haltReason ?? "", String(endMs ?? ""), phaseOutcomes].join("\u0000"), 24);
}
function phaseEventId(runId: string, p: WhisperWorkflowRunRow["phases"][number]): string {
  return sha256Short([p.phaseRunId, p.outcome ?? "", p.startedAt ?? "", p.endedAt ?? ""].join("\u0000"), 24);
}

export function archiveOnce(
  db: Database.Database,
  reader: Pick<WhisperStoreReader, "listCollabIds" | "readAllWorkflows" | "readSchemaVersion">,
  opts: { nowMs: number },
): { workflows: number; phases: number; firstCaptureAt: number | null } {
  // Provenance: stamp each row with the SOURCE DB's real user_version, never a hardcoded
  // default — a supported v6 whisper DB must be recorded as v6, not v7 (§5, §10.3).
  const schemaVersion = reader.readSchemaVersion() ?? 0;
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
  return { listCollabIds: () => collabs, readAllWorkflows: () => [], readSchemaVersion: () => 7 };
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
      readSchemaVersion: () => 7,
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
  reader: Pick<WhisperStoreReader, "listCollabIds" | "readAllWorkflows" | "readSchemaVersion">;
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

  it("does not fork a worker while disabled (master kill / opt-out)", () => {
    const fork = vi.fn(() => fakeProc());
    const host = new InsightsHost({
      userDataDir: ud(), whisperDbPath: null, pollIntervalMs: 3000,
      forkWorker: fork, send: () => {}, loadNoticeShown: () => false, persistNoticeShown: () => {},
    });
    host.setEnabled(false);
    expect(fork).not.toHaveBeenCalled();
  });

  it("delivers the notice at most once per session and never after ack", () => {
    const userDataDir = ud();
    const proc = fakeProc();
    let shown = false;
    const onNotice = vi.fn();
    const host = new InsightsHost({
      userDataDir, whisperDbPath: join(userDataDir, "state.db"), pollIntervalMs: 3000,
      forkWorker: () => proc, send: (ch) => { if (ch === "insights:notice") onNotice(); },
      loadNoticeShown: () => shown, persistNoticeShown: (v) => { shown = v; },
    });
    host.setEnabled(true);
    proc.emit("spawn");
    const status = { kind: "status", status: { lastPollAt: 1, observationCount: 1, whisperAvailable: true, firstCaptureAt: 123 } };
    proc.emit("message", status);
    proc.emit("message", status); // second poll — must NOT re-deliver (session guard)
    expect(onNotice).toHaveBeenCalledTimes(1);
    host.ackNotice();             // persists shown=true + sets the session guard
    proc.emit("message", status); // after ack — still no delivery
    expect(onNotice).toHaveBeenCalledTimes(1);
  });

  it("re-delivers an UNACKNOWLEDGED notice after a worker restart, then stays suppressed once acked", () => {
    const userDataDir = ud();
    let shown = false;
    const onNotice = vi.fn();
    let proc = fakeProc();
    const host = new InsightsHost({
      userDataDir, whisperDbPath: null, pollIntervalMs: 3000,
      forkWorker: () => proc, send: (ch) => { if (ch === "insights:notice") onNotice(); },
      loadNoticeShown: () => shown, persistNoticeShown: (v) => { shown = v; },
    });
    const status = { kind: "status", status: { lastPollAt: 1, observationCount: 1, whisperAvailable: true, firstCaptureAt: 123 } };

    host.setEnabled(true); proc.emit("spawn"); proc.emit("message", status);
    expect(onNotice).toHaveBeenCalledTimes(1);   // session 1 delivery (unacknowledged)

    host.setEnabled(false);                       // worker stops → session guard resets
    proc = fakeProc(); host.setEnabled(true); proc.emit("spawn"); proc.emit("message", status);
    expect(onNotice).toHaveBeenCalledTimes(2);   // session 2 RE-delivers (still unacknowledged)

    host.ackNotice();                             // durable ack persists shown=true
    host.setEnabled(false);
    proc = fakeProc(); host.setEnabled(true); proc.emit("spawn"); proc.emit("message", status);
    expect(onNotice).toHaveBeenCalledTimes(2);   // no re-delivery after ack (durable suppression via loadNoticeShown)
  });

  it("does NOT re-deliver after ack even if the persist is still pending (async-ack race)", () => {
    const userDataDir = ud();
    let persisted = false; // loadNoticeShown's backing store — flushed LATER, never synchronously on ack
    const onNotice = vi.fn();
    let proc = fakeProc();
    const host = new InsightsHost({
      userDataDir, whisperDbPath: null, pollIntervalMs: 3000,
      forkWorker: () => proc, send: (ch) => { if (ch === "insights:notice") onNotice(); },
      loadNoticeShown: () => persisted,
      persistNoticeShown: () => { /* deferred: the settings write has NOT flushed, so `persisted` stays false */ },
    });
    const status = { kind: "status", status: { lastPollAt: 1, observationCount: 1, whisperAvailable: true, firstCaptureAt: 123 } };

    host.setEnabled(true); proc.emit("spawn"); proc.emit("message", status);
    expect(onNotice).toHaveBeenCalledTimes(1);
    host.ackNotice();               // acknowledged=true synchronously; persist NOT yet flushed (persisted still false)
    host.setEnabled(false);         // disable immediately after ack → stop() resets sessionNoticeSent
    proc = fakeProc(); host.setEnabled(true); proc.emit("spawn"); proc.emit("message", status);
    expect(onNotice).toHaveBeenCalledTimes(1); // in-process `acknowledged` guard blocks the stale re-delivery
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
  private sessionNoticeSent = false; // at-most-once PER worker session; reset on stop() so UNACKED notices re-deliver
  private acknowledged = false;      // in-process ack, INDEPENDENT of the worker lifecycle; never reset on stop()

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
    this.sessionNoticeSent = false; // per-worker-lifecycle: an UNACKNOWLEDGED notice must re-deliver on the next start
    this.proc?.kill();
    this.proc = null;
  }

  // Deliver at most once per worker session, and never once acknowledged. The in-process
  // `acknowledged` flag suppresses re-delivery even if `persistNoticeShown` has not flushed yet,
  // so a disable→re-enable right after ack cannot re-fire on a stale `loadNoticeShown() === false`.
  private maybeDeliverNotice(): void {
    if (this.sessionNoticeSent || this.acknowledged || this.opts.loadNoticeShown()) return;
    this.sessionNoticeSent = true;
    this.opts.send(INSIGHTS_NOTICE_CHANNEL, {});
  }

  private onMessage(msg: InsightsWorkerToMain): void {
    if (msg.kind === "status") { if (msg.status.firstCaptureAt != null) this.maybeDeliverNotice(); return; }
    if (msg.kind === "firstCapture") { this.maybeDeliverNotice(); return; }
    if (msg.kind === "storeClosed") { this.pendingClose?.(); this.pendingClose = null; return; }
    if (msg.kind === "queryResult") { this.opts.send("insights:queryResult", msg); return; }
  }

  /** Renderer ack (insights:noticeAck). Sets the in-process `acknowledged` guard synchronously — so
   *  re-delivery stops at once regardless of when the async persist flushes — and persists
   *  `noticeShown` durably for the next app launch. */
  ackNotice(): void { this.acknowledged = true; this.sessionNoticeSent = true; this.opts.persistNoticeShown(true); }

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
import { mkdirSync } from "node:fs";
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

**Register the worker as a build input.** Electron Vite currently builds only `index` + `usage-worker` (`electron.vite.config.ts:39`), so the forked `./insights-worker.js` will not exist in `out/main/` unless added. Extend `rollupOptions.input`:

```ts
input: {
  index: "./electron/main/index.ts",
  "usage-worker": "./electron/main/services/usage-worker.ts",
  "insights-worker": "./electron/main/services/insights-worker.ts",
},
```

A build guard in Task 14 asserts `out/main/insights-worker.js` exists after `electron-vite build`.

> Note: whisper DB path resolution in the main process — reuse the exact value computed at `electron/main/index.ts:270` (`process.env.AI14ALL_WHISPER_STATE_ROOT ?? join(homedir(), ".ai-whisper")`, then `join(root, "state.db")`) for `whisperDbPath`, passed into `InsightsHostOptions` when wiring the host at app startup (alongside the existing `UsageHost` wiring). `loadNoticeShown` reads `usageTelemetry.insights.noticeShown` **freshly** via `settingsService.readStateSync()` (not a possibly-stale bridge snapshot); `persistNoticeShown` writes it via `settingsService.writeState(...)` (Task 11/12).

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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsService } from "../../../../services/settings/settings-service.js";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../../shared/models/persisted-settings.js";
import { isInsightsCaptureEnabled, UsageTelemetrySettingsSchema } from "../../../../shared/models/persisted-workspace-state.js";

const dirs: string[] = [];
const service = () => { const d = mkdtempSync(join(tmpdir(), "ins-set-")); dirs.push(d); return new SettingsService(join(d, "settings.json"), join(d, "legacy.json")); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const t = (over = {}) => ({ enabled: true, includeUntracked: false, chipRange: "week" as const, insights: { enabled: true, noticeShown: false }, ...over });

describe("insights settings", () => {
  it("defaults insights on across schema, DEFAULT_PERSISTED_SETTINGS, and a fresh service read", async () => {
    expect(UsageTelemetrySettingsSchema.parse({}).insights).toEqual({ enabled: true, noticeShown: false });
    expect(DEFAULT_PERSISTED_SETTINGS.usageTelemetry.insights).toEqual({ enabled: true, noticeShown: false }); // outer default literal
    const { settings } = await service().readState(); // first-run seed writes the file
    expect(settings.usageTelemetry.insights).toEqual({ enabled: true, noticeShown: false });
  });

  it("isInsightsCaptureEnabled honors the master kill (either toggle false → false)", () => {
    expect(isInsightsCaptureEnabled(t())).toBe(true);
    expect(isInsightsCaptureEnabled(t({ enabled: false }))).toBe(false);                             // global opt-out wins
    expect(isInsightsCaptureEnabled(t({ insights: { enabled: false, noticeShown: false } }))).toBe(false);
  });

  it("the REAL SettingsService.writeState deep-merges insights, preserving noticeShown", async () => {
    const s = service();
    await s.readState(); // seed defaults into the temp file
    await s.writeState({ usageTelemetry: { insights: { noticeShown: true } } });
    await s.writeState({ usageTelemetry: { insights: { enabled: false } } }); // partial — must NOT reset noticeShown
    const { settings } = await s.readState(); // reload from disk
    expect(settings.usageTelemetry.insights).toEqual({ enabled: false, noticeShown: true });
    expect(settings.usageTelemetry.enabled).toBe(true); // sibling untouched
  });
});
```

This test drives the **real** `SettingsService` against a temp file (not a local `merge()` copy), so it fails if the service shallow-merges — exactly the regression the reviewer flagged.

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

// Effective insights-capture consent: global telemetry AND the insights sub-toggle (master kill).
// `UsageTelemetrySettings` is the existing exported `z.infer<typeof UsageTelemetrySettingsSchema>`
// type in this file — reference it, do not redeclare it.
export function isInsightsCaptureEnabled(t: UsageTelemetrySettings): boolean {
  return t.enabled && t.insights.enabled;
}
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

**Also** add `insights` to the **outer default literal** in `PersistedSettingsV1Schema` (`persisted-settings.ts:40`). That `.default({...})` object is returned as-is on a first run and currently omits `insights`, so `DEFAULT_PERSISTED_SETTINGS.usageTelemetry.insights` (and every first-run `readState()`) would be `undefined` — the inner schema default does not backfill it:

```ts
usageTelemetry: UsageTelemetrySettingsSchema.default({
  enabled: true,
  includeUntracked: false,
  chipRange: "week",
  insights: { enabled: true, noticeShown: false },
}),
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
- Create: `electron/main/insights-ipc.ts` (`registerInsightsIpc` + `applyInsightsConsent`)
- Modify: `electron/main/ipc.ts` (call `registerInsightsIpc`; add `insightsHost` dep) + the app-startup wiring that constructs `InsightsHost` and calls `applyInsightsConsent` at startup and on `settings:write`
- Modify: `shared/contracts/commands.ts` (add the `insights` member to `Ai14AllDesktopApi`)
- Modify: `electron/preload/index.ts` (implement `insights` on the `window.ai14all` `api` object)
- Test: `tests/unit/insights/insights-ipc.test.ts` (registration + `applyInsightsConsent` master kill)

**Interfaces:**
- Consumes: `InsightsHost` (Task 10), `isInsightsCaptureEnabled` (Task 11).
- Produces: IPC channels `insights:setEnabled`, `insights:deleteAll`, `insights:noticeAck`; forwarded renderer event `insights:notice`; `applyInsightsConsent(host, settings)` and `makeSetInsightsEnabled(settingsService, host)`; the `Ai14AllDesktopApi.insights = { setEnabled, deleteAll, ackNotice, onNotice }` contract on `window.ai14all`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/insights/insights-ipc.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyInsightsConsent, makeSetInsightsEnabled, registerInsightsIpc } from "../../../electron/main/insights-ipc.js";
import { SettingsService } from "../../../services/settings/settings-service.js";

function stubIpcMain() {
  const handlers = new Map<string, (...a: any[]) => any>();
  return { handle: (ch: string, fn: any) => handlers.set(ch, fn), invoke: (ch: string, ...a: any[]) => handlers.get(ch)!({}, ...a), has: (ch: string) => handlers.has(ch) };
}
const sett = (over: any = {}) => ({ usageTelemetry: { enabled: true, includeUntracked: false, chipRange: "week", insights: { enabled: true, noticeShown: false }, ...over } }) as any;

describe("insights IPC", () => {
  it("registers setEnabled + deleteAll + noticeAck; setEnabled routes to the persist+derive closure (never host.setEnabled)", async () => {
    const ipc = stubIpcMain();
    const host = { deleteAll: vi.fn().mockResolvedValue(undefined), ackNotice: vi.fn() };
    const setInsightsEnabled = vi.fn();
    registerInsightsIpc(ipc as any, host as any, setInsightsEnabled);
    expect(ipc.has("insights:setEnabled")).toBe(true);
    await ipc.invoke("insights:setEnabled", true);
    expect(setInsightsEnabled).toHaveBeenCalledWith(true); // to the closure — the raw boolean never reaches the host directly
    await ipc.invoke("insights:deleteAll");
    expect(host.deleteAll).toHaveBeenCalled();
    ipc.invoke("insights:noticeAck");
    expect(host.ackNotice).toHaveBeenCalled();
  });

  it("applyInsightsConsent enforces the master kill from persisted settings (raw true never forces start)", () => {
    const setEnabled = vi.fn();
    applyInsightsConsent({ setEnabled }, sett());                                                   // both on
    applyInsightsConsent({ setEnabled }, sett({ enabled: false }));                                 // global off
    applyInsightsConsent({ setEnabled }, sett({ insights: { enabled: false, noticeShown: false } })); // sub off
    expect(setEnabled.mock.calls.map((c) => c[0])).toEqual([true, false, false]);
  });

  it("makeSetInsightsEnabled persists then derives via the REAL SettingsService (global off ⇒ host stays stopped)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ins-ipc-"));
    try {
      const svc = new SettingsService(join(dir, "settings.json"), join(dir, "legacy.json"));
      await svc.readState();                                   // seed defaults
      await svc.writeState({ usageTelemetry: { enabled: false } }); // global telemetry OFF (sub-toggle still on)
      const host = { setEnabled: vi.fn() };
      const setInsightsEnabled = makeSetInsightsEnabled(svc, host as any); // the ACTUAL wiring closure

      await setInsightsEnabled(true);                          // user flips the insights sub-toggle ON…
      expect(host.setEnabled).toHaveBeenCalledWith(false);     // …global opt-out wins: host stays stopped (master kill)
      const { settings } = await svc.readState();
      expect(settings.usageTelemetry.insights.enabled).toBe(true); // …but the sub-preference IS persisted
    } finally { rmSync(dir, { recursive: true, force: true }); }
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
  host: Pick<InsightsHost, "deleteAll" | "ackNotice">,
  // Persists the requested sub-setting, THEN derives effective consent server-side.
  // It never forwards the raw renderer boolean to host.setEnabled (§7.2 master kill).
  setInsightsEnabled: (enabled: boolean) => void | Promise<void>,
): void {
  ipcMain.handle("insights:setEnabled", async (_e, enabled: unknown) => { await setInsightsEnabled(Boolean(enabled)); });
  ipcMain.handle("insights:deleteAll", async () => { await host.deleteAll(); });
  ipcMain.handle("insights:noticeAck", () => { host.ackNotice(); });
}
```

In `electron/main/ipc.ts` `registerIpcHandlers(...)`, add an `insightsHost?: InsightsHost` field to the options object (next to `usageHost?` at `:172`) and call `if (insightsHost) registerInsightsIpc(ipcMain, insightsHost, setInsightsEnabled);` (passing the persist-then-derive closure defined in the wiring above). Import `registerInsightsIpc` and `InsightsHost` at the top. The `insights:notice` event is emitted by `InsightsHost` via the `send` seam it already receives (`mainWindow.webContents.send`), so no extra emit code is needed here.

At app startup, construct `InsightsHost` right after `new UsageHost(...)` (`electron/main/index.ts:199`), **reusing the same `usageSettings` bridge** the usage host already uses (`electron/main/index.ts:185`–`208`). This avoids the private `SettingsService.current` field (`settings-service.ts:38` — it does **not** compile from outside the class); the bridge's `.settings` is the retained synchronous snapshot, exactly the source `loadSettings: () => usageSettings.settings` already uses.
- `userDataDir` = the same `app.getPath("userData")` passed to `UsageHost`,
- `whisperDbPath` = `join(whisperStateRoot, "state.db")` where `whisperStateRoot = process.env.AI14ALL_WHISPER_STATE_ROOT ?? join(homedir(), ".ai-whisper")` — the exact value already computed at `electron/main/index.ts:270` and used for the whisper reader at `:346`,
- `send` = `(ch, p) => mainWindow.webContents.send(ch, p)` (the same seam `UsageHost` uses),
- `loadNoticeShown` = `() => settingsService.readStateSync().settings.usageTelemetry.insights.noticeShown` (read **fresh** each poll — `readStateSync()` is public and synchronous (`index.ts:176,548`), so an ack persisted via `writeState` is reflected on the next status; never the possibly-stale bridge snapshot or the private `current`),
- `persistNoticeShown` = `(v) => void settingsService.writeState({ usageTelemetry: { insights: { noticeShown: v } } })` (public `writeState`, which deep-merges `insights` per Task 11).

**Effective-consent gating (master-kill-safe).** Do **not** let the renderer drive `InsightsHost.setEnabled` directly. Export a single seam and use it at startup **and** on every `settings:write` — never trusting a renderer boolean:

```ts
// electron/main/insights-ipc.ts (or alongside the host wiring)
import { isInsightsCaptureEnabled } from "../../shared/models/persisted-workspace-state.js";
import type { InsightsHost } from "./services/insights-host.js";
import type { SettingsService } from "../../services/settings/settings-service.js";
import type { PersistedSettingsV1 } from "../../shared/models/persisted-settings.js";
export function applyInsightsConsent(host: Pick<InsightsHost, "setEnabled">, settings: PersistedSettingsV1): void {
  host.setEnabled(isInsightsCaptureEnabled(settings.usageTelemetry)); // global AND insights sub-toggle
}

// The REAL persist-then-derive closure the insights:setEnabled handler uses. It persists the
// sub-setting, then derives effective consent from the WRITTEN settings — never the raw renderer
// boolean. Exported so the master-kill test exercises this exact function, not a local copy.
export function makeSetInsightsEnabled(
  settingsService: Pick<SettingsService, "writeState">,
  host: Pick<InsightsHost, "setEnabled">,
): (enabled: boolean) => Promise<void> {
  return async (enabled) => {
    const next = await settingsService.writeState({ usageTelemetry: { insights: { enabled } } });
    applyInsightsConsent(host, next);
  };
}
```

Call `applyInsightsConsent(insightsHost, settingsService.readStateSync().settings)` at startup and inside the `settings:write` handler (mirror the existing `usageHost.setEnabled` live-apply near `ipc.ts` `:588`). The `insights:setEnabled(enabled)` IPC (**required by spec §7.3**) is registered with a closure that **persists the sub-setting then derives** effective consent — it never forwards the raw boolean:

```ts
const setInsightsEnabled = makeSetInsightsEnabled(settingsService, insightsHost); // persist sub-setting → derive consent
registerInsightsIpc(ipcMain, insightsHost, setInsightsEnabled);
```

The Settings toggle (Task 13) persists via `update(...)` (refreshing the renderer and, through the `settings:write` live-apply, calling `applyInsightsConsent`); `insights.setEnabled` remains the direct programmatic API with identical persist-then-derive semantics.

First extend the **shared contract** so `window.ai14all.insights` type-checks. In `shared/contracts/commands.ts`, add an `insights` member to `Ai14AllDesktopApi` (`:435`), following the grouped-member style (e.g. `usage:` at `:585`, `terminals:` with `onX` event subscribers):

```ts
insights: {
  setEnabled(enabled: boolean): Promise<void>;
  deleteAll(): Promise<void>;
  ackNotice(): Promise<void>;
  onNotice(listener: () => void): () => void;
};
```

Then, in `electron/preload/index.ts`, add the implementation to the existing `const api: Ai14AllDesktopApi = { … }` object (`:153`) that is exposed as **`window.ai14all`** via `contextBridge.exposeInMainWorld("ai14all", api)` — there is **no** `window.api`:

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

(`setEnabled` is the spec-required programmatic API; its handler persists the sub-setting then derives effective consent — see the wiring above. The Settings toggle itself persists via `update(...)`, which also gates the host through the `settings:write` live-apply.)

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test tests/unit/insights/insights-ipc.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main/insights-ipc.ts electron/main/ipc.ts shared/contracts/commands.ts electron/preload/index.ts tests/unit/insights/insights-ipc.test.ts
git commit -m "feat(insights): setEnabled(persist+derive)/deleteAll/noticeAck IPC + applyInsightsConsent master kill, window.ai14all.insights bridge, host wiring"
```

---

## Task 13: Settings UI — insights toggle, delete action, first-capture notice

**Files:**
- Create: `src/features/settings/components/InsightsSettingsControls.tsx` (toggle + delete action; uses `useSettings().update`)
- Modify: `src/features/settings/components/SettingsDialog.tsx` (Usage section, ~`:203` — mount `<InsightsSettingsControls />`)
- Create: `src/app/components/InsightsNotice.tsx` (one-time notice with a "Manage in Settings" deep-link)
- Modify: `src/app/App.tsx` (mount `<InsightsNotice onOpenSettings={() => setSettingsOpen(true)} />` using the existing settings opener)
- Test: `tests/unit/features/settings/insights-controls.test.tsx` (renders both components with a stubbed `window.ai14all.insights` + mocked `useSettings`)

**Interfaces:**
- Consumes: `window.ai14all.insights` (Task 12), `settings.usageTelemetry.insights` (Task 11).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/features/settings/insights-controls.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const update = vi.fn();
const settings = { usageTelemetry: { enabled: true, includeUntracked: false, chipRange: "week", insights: { enabled: true, noticeShown: false } } };
vi.mock("../../../../src/app/hooks/use-settings.js", () => ({ useSettings: () => ({ settings, update }) }));

import { InsightsNotice } from "../../../../src/app/components/InsightsNotice.js";
import { InsightsSettingsControls } from "../../../../src/features/settings/components/InsightsSettingsControls.js";

describe("InsightsNotice", () => {
  it("shows on notice; 'Manage in Settings' opens Settings, acknowledges, and dismisses", () => {
    const ack = vi.fn(); const onOpenSettings = vi.fn();
    let fire: () => void = () => {};
    (globalThis as any).window.ai14all = { insights: { ackNotice: ack, onNotice: (cb: () => void) => { fire = cb; return () => {}; } } };
    render(<InsightsNotice onOpenSettings={onOpenSettings} />);
    expect(screen.queryByRole("status")).toBeNull();
    fire();
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /manage in settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1); // deep-links to the Settings dialog
    expect(ack).toHaveBeenCalledTimes(1);            // and acknowledges (durable suppression)
    expect(screen.queryByRole("status")).toBeNull(); // and dismisses
  });
});

describe("InsightsSettingsControls", () => {
  it("toggle persists the sub-preference via update(); delete calls deleteAll", () => {
    update.mockClear();
    const deleteAll = vi.fn();
    (globalThis as any).window.ai14all = { insights: { deleteAll } };
    render(<InsightsSettingsControls />);
    fireEvent.click(screen.getByRole("checkbox", { name: /usage insights/i })); // toggle OFF
    expect(update).toHaveBeenCalledWith({ usageTelemetry: { enabled: true, includeUntracked: false, chipRange: "week", insights: { enabled: false, noticeShown: false } } });
    fireEvent.click(screen.getByRole("button", { name: /delete insights data/i }));
    expect(deleteAll).toHaveBeenCalled();
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

export function InsightsNotice({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element | null {
  const [show, setShow] = useState(false);
  useEffect(() => window.ai14all.insights.onNotice(() => setShow(true)), []);
  if (!show) return null;
  const ackAndClose = () => { window.ai14all.insights.ackNotice(); setShow(false); };
  return (
    <div role="status" className="insights-notice">
      <span>ai-14all now records local, content-free usage insights.</span>
      {/* Deep-links to the Settings dialog, where the enable toggle + delete action live (Task 13). */}
      <button onClick={() => { onOpenSettings(); ackAndClose(); }}>Manage in Settings</button>
      <button onClick={ackAndClose}>Dismiss</button>
    </div>
  );
}
```

Mount `<InsightsNotice onOpenSettings={() => setSettingsOpen(true)} />` once in the top-level app chrome (`src/app/App.tsx`), reusing the **existing** settings-dialog opener: App.tsx already holds the dialog `open` state and passes an `onOpenSettings={() => set…Open(true)}` prop to its chrome while rendering `<SettingsDialog open={…} onOpenChange={…} />` — wire the notice's `onOpenSettings` to that same setter so its "Manage in Settings" action opens the dialog with the toggle + delete controls. Create `src/features/settings/components/InsightsSettingsControls.tsx`, using the dialog's real `useSettings().update` helper — the dialog destructures `{ settings, update }` at `SettingsDialog.tsx:58`; there is **no** `patch`:

```tsx
// src/features/settings/components/InsightsSettingsControls.tsx
import type React from "react";
import { useSettings } from "../../../app/hooks/use-settings.js";

export function InsightsSettingsControls(): React.ReactElement {
  const { settings, update } = useSettings();
  const t = settings.usageTelemetry;
  return (
    <>
      <label className="settings-dialog__row">
        <input
          type="checkbox"
          aria-label="usage insights"
          checked={t.insights.enabled}
          onChange={(e) => {
            // Persist the sub-preference only; the MAIN process derives effective consent
            // and starts/stops the host on settings:write (applyInsightsConsent, Task 12).
            // Spreading the full nested objects matches the dialog's existing usageTelemetry handlers.
            update({ usageTelemetry: { ...t, insights: { ...t.insights, enabled: e.target.checked } } });
          }}
        />
        usage insights (local, content-free)
      </label>
      <button className="settings-dialog__danger" onClick={() => void window.ai14all.insights.deleteAll()}>
        Delete insights data
      </button>
    </>
  );
}
```

Then render `<InsightsSettingsControls />` inside the Usage `<section>` of `SettingsDialog.tsx` (after the existing `usageTelemetry.enabled` toggle at `:203`–`:218`) — a single JSX line, keeping the dialog thin.

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
- Create: `tests/e2e/fixtures/gen-whisper-state.ts` (one-off generator, kept for regeneration)
- Create: `tests/e2e/fixtures/whisper-state-v7.db` (1-workflow fixture) and `tests/e2e/fixtures/whisper-state-v7-2wf.db` (2-workflow "altered source")

**Interfaces:**
- Consumes: the full wired app (Tasks 1–13), and the real env seams `AI14ALL_USER_DATA_PATH` + `AI14ALL_WHISPER_STATE_ROOT` (honored by `electron/main/index.ts:88,270`).

**Design note:** AGENTS.md:159–160 require e2e for new user-visible behavior, and a *skipped* test provides none. `window.ai14all` **is** available in the current e2e harness — many non-skipped tests drive it via `page.evaluate` (`session-attention.spec.ts`, `settings-persistence.test.ts`), so the stale `review-mcp.test.ts` skip note does not apply here. All three tests below therefore **run**: (1) a renderer-independent capture/consent-stop test (disabled at startup via a seeded `settings.json`); (2) a **durable-ack** test that relaunches immediately after acknowledgement while still enabled with the store retained, so only a persisted ack can suppress the notice; and (3) a **live-toggle** test that unchecks insights in the running app, then alters the source and asserts nothing new is archived. Each stop assertion **alters the source** (swaps in a 2-workflow fixture) so a still-running worker *would* archive a new observation — proving capture stopped, not merely idempotent idle — and **fingerprints every file under `insights/` (db + WAL + SHM)**, so a write hidden in `insights.db-wal` (WAL mode, Task 10) still fails it. Concrete paths: `<AI14ALL_USER_DATA_PATH>/settings.json` and `<AI14ALL_USER_DATA_PATH>/insights/insights.db` (userData is set from that env at `index.ts:88`).

- [ ] **Step 1: Generate + commit two prebuilt whisper fixtures**

The e2e process runs on the **Electron** ABI (`pretest:e2e` rebuilds `better-sqlite3` for Electron), so it cannot `require` the host-ABI module to build a fixture in-process. Generate both fixtures once under the host ABI and commit the binaries. Create `tests/e2e/fixtures/gen-whisper-state.ts` (ESM-safe — no `__dirname`):

```ts
// tests/e2e/fixtures/gen-whisper-state.ts
// Run: node scripts/rebuild-better-sqlite3-host.mjs && pnpm exec tsx tests/e2e/fixtures/gen-whisper-state.ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeWhisperFixtureDb } from "../../unit/plugins/helpers/make-whisper-fixture-db.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const wf = (id: string, over = {}) => ({ workflowId: id, collabId: "c1", workflowType: "spec-driven-development", status: "done", currentPhaseIndex: 0, createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:05:00.000Z", ...over });
const ph = (run: string) => ({ phaseRunId: `${run}:pa`, workflowId: run, phaseIndex: 0, phaseName: "impl", chainId: "ch1", startedAt: "2026-07-19T00:00:00.000Z", endedAt: "2026-07-19T00:05:00.000Z", outcome: "ok" });
const collabs = [{ collabId: "c1", workspaceRoot: "/tmp/e2e-repo", displayName: "r", status: "active" }];

makeWhisperFixtureDb(join(HERE, "whisper-state-v7.db"),     { schemaVersion: 7, collabs, workflows: [wf("wf1")],           phases: [ph("wf1")] });
makeWhisperFixtureDb(join(HERE, "whisper-state-v7-2wf.db"), { schemaVersion: 7, collabs, workflows: [wf("wf1"), wf("wf2")], phases: [ph("wf1"), ph("wf2")] });
```

Run it once, then `git add tests/e2e/fixtures/whisper-state-v7.db tests/e2e/fixtures/whisper-state-v7-2wf.db`.

- [ ] **Step 2: Write the e2e test (non-skipped capture/stop + skip-gated UI)**

```ts
// tests/e2e/insights.test.ts
import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

const HERE = dirname(fileURLToPath(import.meta.url)); // ESM-safe; no __dirname
// Complete-enough settings.json; omitted top-level fields fall back to schema defaults on parse.
const disabledSettings = JSON.stringify({
  version: 1,
  usageTelemetry: { enabled: false, includeUntracked: false, chipRange: "week", insights: { enabled: false, noticeShown: true } },
});

let repo: TestRepo, userDataDir: string, whisperRoot: string;
const insightsDir = () => join(userDataDir, "insights");
const storePath = () => join(insightsDir(), "insights.db");
// Fingerprint EVERY file under insights/ (db + WAL + SHM), so a write hidden in -wal is still observed.
const fingerprint = (): string => {
  try {
    return readdirSync(insightsDir(), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => { const s = statSync(join(insightsDir(), e.name)); return `${e.name}:${s.size}:${s.mtimeMs}`; })
      .sort().join("|");
  } catch { return "<none>"; }
};
const launch = (): Promise<ElectronApplication> => electron.launch({
  args: ["out/main/index.js"],
  env: { ...process.env, AI14ALL_E2E: "1", AI14ALL_E2E_PICK_PATH: repo.repoPath, AI14ALL_USER_DATA_PATH: userDataDir, AI14ALL_WHISPER_STATE_ROOT: whisperRoot },
});

test.beforeEach(() => {
  repo = createTestRepo();
  userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-insights-ud-")));
  whisperRoot = realpathSync(mkdtempSync(join(tmpdir(), "ofa-insights-wr-")));
  cpSync(join(HERE, "fixtures", "whisper-state-v7.db"), join(whisperRoot, "state.db")); // 1 workflow
});
test.afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(whisperRoot, { recursive: true, force: true });
});

// RUNS (renderer-independent). Proves capture, then that disabling consent stops it even when the
// source GAINS a workflow — no-new-capture, not merely idempotent idle. WAL-aware.
test("captures on consent; a disabled relaunch archives no new source workflows (db+WAL+SHM)", async () => {
  let app = await launch();
  await app.firstWindow();
  await expect.poll(() => existsSync(storePath()), { timeout: 20_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 4_000)); // let the first archive settle
  const before = fingerprint();
  await closeApp(app);

  writeFileSync(join(userDataDir, "settings.json"), disabledSettings);                       // consent OFF
  cpSync(join(HERE, "fixtures", "whisper-state-v7-2wf.db"), join(whisperRoot, "state.db"));  // ALTER source

  app = await launch();
  await app.firstWindow();
  await new Promise((r) => setTimeout(r, 8_000));                                            // several poll intervals
  const after = fingerprint();
  await closeApp(app);

  expect(after).toBe(before); // no file under insights/ (incl. -wal/-shm) changed → 2nd workflow never archived
});

// RUNS: window.ai14all is available in e2e (see session-attention.spec.ts / settings-persistence.test.ts).

// Prove DURABLE ack suppression: relaunch immediately after ack, still ENABLED with the store retained,
// so ONLY a persisted acknowledgement (not a disabled worker or a deleted store) can suppress the notice.
test("acknowledgement durably suppresses the notice across a relaunch (still enabled, store kept)", async () => {
  let app = await launch();
  let page = await app.firstWindow();
  await expect.poll(() => existsSync(storePath()), { timeout: 20_000 }).toBe(true);

  await expect(page.getByRole("status")).toContainText("usage insights");
  await page.getByRole("button", { name: /manage in settings/i }).click(); // opens Settings AND acknowledges
  await expect(page.getByTestId("settings-dialog")).toBeVisible();
  await page.keyboard.press("Escape"); // close dialog; leave insights ENABLED and the store in place

  await closeApp(app); app = await launch(); page = await app.firstWindow(); // relaunch, capture still enabled
  await page.waitForTimeout(5_000);
  await expect(page.getByRole("status")).toHaveCount(0); // only the persisted ack can explain this
  await closeApp(app);
});

// Prove the LIVE Settings toggle actually STOPS capture (not just persists a flag): after unchecking,
// alter the whisper source and verify the running app archives nothing; then delete-all.
test("live Settings toggle stops capture against an altered source; delete-all removes db+WAL+SHM", async () => {
  let app = await launch();
  let page = await app.firstWindow();
  const p = storePath();
  await expect.poll(() => existsSync(p), { timeout: 20_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 4_000)); // let the first archive settle

  // Open Settings via the notice, then UNCHECK insights (real control → settings:write → applyInsightsConsent).
  await page.getByRole("button", { name: /manage in settings/i }).click();
  await expect(page.getByTestId("settings-dialog")).toBeVisible();
  await page.getByRole("checkbox", { name: /usage insights/i }).uncheck();
  await expect
    .poll(() => page.evaluate(() => window.ai14all.settings.read().then((r) => r.settings.usageTelemetry.insights.enabled)))
    .toBe(false);

  // Alter the source (2-workflow fixture) WITHOUT relaunching. A broken live consent apply would archive it.
  const before = fingerprint();
  cpSync(join(HERE, "fixtures", "whisper-state-v7-2wf.db"), join(whisperRoot, "state.db"));
  await page.waitForTimeout(8_000); // several poll intervals
  expect(fingerprint()).toBe(before); // live toggle stopped the worker → nothing new archived (incl. -wal/-shm)

  // Delete insights data → db + WAL + SHM removed.
  await page.getByRole("button", { name: /delete insights data/i }).click();
  await expect.poll(() => existsSync(p) || existsSync(`${p}-wal`) || existsSync(`${p}-shm`), { timeout: 5_000 }).toBe(false);
  await closeApp(app);
});
```

- [ ] **Step 3: Run the e2e**

Run: `pnpm test:e2e insights`
Expected: **all three** tests PASS (renderer-independent capture/consent-stop, durable-ack-across-relaunch, and live-toggle-stops-capture + delete). (`pretest:e2e` rebuilds for the Electron ABI; `posttest:e2e` restores the host ABI.)

- [ ] **Step 4: Build guard + full suite + typecheck + lint**

Run `pnpm build`, then verify the worker artifact exists (Task 10's Vite input):

```bash
test -f out/main/insights-worker.js || { echo "MISSING out/main/insights-worker.js — add it to electron.vite.config.ts input"; exit 1; }
```

Then: `pnpm typecheck && pnpm lint && pnpm test` (unit suite, host ABI) and `pnpm test:e2e` (Electron ABI).
Expected: all green; `out/main/insights-worker.js` present.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/insights.test.ts tests/e2e/fixtures/gen-whisper-state.ts tests/e2e/fixtures/whisper-state-v7.db tests/e2e/fixtures/whisper-state-v7-2wf.db
git commit -m "test(insights): e2e capture + WAL-aware consent-stop, durable-ack relaunch, and live-toggle-stops-capture + delete (all run)"
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
- Review fixes through round 7 are folded in: recursive privacy guard over the full persisted set (Task 3); provenance stamps the source DB's real `user_version` (Task 8); real-`SettingsService` settings tests including the outer default (Task 11); startup wiring reuses the `usageSettings` bridge + public `writeState` (never private `current`), the worker is a Vite build input, and its `require` is now an import (Tasks 10, 12); the spec-required `insights.setEnabled` API is preserved and its handler uses the **extracted, exported `makeSetInsightsEnabled`** closure — persist the sub-setting, then derive effective consent server-side — with a master-kill test that exercises the **real** closure against a temp-file `SettingsService` (Task 12); the notice separates an **in-process `acknowledged` guard** (never reset on `stop()`) from the per-worker `sessionNoticeSent` state, so an unacked notice re-delivers on the next worker start but a post-ack disable→re-enable cannot re-fire on a not-yet-flushed persist, and it **deep-links to Settings** via "Manage in Settings" (Tasks 10, 13); the UI targets the real `window.ai14all`/`Ai14AllDesktopApi` contract (Tasks 12, 13); the reader carries a source-unchanged read-only regression test (Task 7); and **three** e2e tests run — capture/consent-stop, **durable-ack across a relaunch** (before disable/delete), and a **live Settings toggle** that stops capture against an altered source — all fingerprinting db+WAL+SHM, plus a build guard for `out/main/insights-worker.js` (Task 14). The only implementer discretion left is the exact insertion point of `new InsightsHost(...)` beside `new UsageHost(...)` in `electron/main/index.ts`.
