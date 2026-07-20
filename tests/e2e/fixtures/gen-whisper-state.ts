// One-off generator for the two prebuilt ai-whisper `state.db` fixtures consumed
// by tests/e2e/insights.test.ts. The e2e process runs on the ELECTRON ABI
// (pretest:e2e rebuilds better-sqlite3 for Electron), so it cannot build a
// fixture in-process; we generate both binaries once under the host ABI and
// commit them.
//
// makeWhisperFixtureDb builds the DB with the ABI-independent `node:sqlite`
// module and expects SNAKE_CASE row keys (workflow_id, phase_run_id, …) — the
// same read contract WhisperStoreReader queries.
//
// Regenerate with:
//   node scripts/rebuild-better-sqlite3-host.mjs && pnpm exec tsx tests/e2e/fixtures/gen-whisper-state.ts
// then commit the binaries:
//   git add tests/e2e/fixtures/whisper-state-v7.db tests/e2e/fixtures/whisper-state-v7-2wf.db
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	makeWhisperFixtureDb,
	type WhisperFixture,
} from "../../unit/plugins/helpers/make-whisper-fixture-db.js";

// ESM-safe module directory (no __dirname under NodeNext).
const HERE = dirname(fileURLToPath(import.meta.url));

type WorkflowRow = NonNullable<WhisperFixture["workflows"]>[number];
type PhaseRow = NonNullable<WhisperFixture["phases"]>[number];

// A terminal ("done") workflow with one finished phase → the archiver mints one
// whisper.workflow + one whisper.phase observation, marking first_capture_at.
const wf = (id: string, over: Partial<WorkflowRow> = {}): WorkflowRow => ({
	workflow_id: id,
	collab_id: "c1",
	workflow_type: "spec-driven-development",
	status: "done",
	current_phase_index: 0,
	created_at: "2026-07-19T00:00:00.000Z",
	updated_at: "2026-07-19T00:05:00.000Z",
	...over,
});

const ph = (run: string): PhaseRow => ({
	phase_run_id: `${run}:pa`,
	workflow_id: run,
	phase_index: 0,
	phase_name: "impl",
	chain_id: "ch1",
	started_at: "2026-07-19T00:00:00.000Z",
	ended_at: "2026-07-19T00:05:00.000Z",
	outcome: "ok",
});

const collabs: WhisperFixture["collabs"] = [
	{
		collab_id: "c1",
		workspace_root: "/tmp/e2e-repo",
		display_name: "r",
		status: "active",
	},
];

// 1-workflow baseline fixture.
makeWhisperFixtureDb(join(HERE, "whisper-state-v7.db"), {
	schemaVersion: 7,
	collabs,
	workflows: [wf("wf1")],
	phases: [ph("wf1")],
});

// 2-workflow "altered source": swapped in after a stop assertion so a still-running
// worker WOULD archive the extra workflow — proving capture stopped, not idle.
makeWhisperFixtureDb(join(HERE, "whisper-state-v7-2wf.db"), {
	schemaVersion: 7,
	collabs,
	workflows: [wf("wf1"), wf("wf2")],
	phases: [ph("wf1"), ph("wf2")],
});

console.log(
	"wrote tests/e2e/fixtures/whisper-state-v7.db and whisper-state-v7-2wf.db",
);
