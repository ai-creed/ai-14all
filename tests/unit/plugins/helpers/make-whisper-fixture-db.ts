import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface WhisperFixture {
	schemaVersion?: number;
	collabs?: Array<{
		collab_id: string;
		workspace_root: string;
		display_name?: string;
		status?: string;
	}>;
	daemons?: Array<{
		collab_id: string;
		host?: string;
		port?: number;
		pid?: number | null;
		last_heartbeat_at: string;
	}>;
	bindings?: Array<{
		collab_id: string;
		agent_type: string;
		binding_state: string;
	}>;
	workflows?: Array<{
		workflow_id: string;
		collab_id: string;
		workflow_type?: string;
		status?: string;
		current_phase_index?: number;
		halt_reason?: string | null;
		updated_at?: string;
	}>;
	phases?: Array<{
		phase_run_id: string;
		workflow_id: string;
		phase_index: number;
		phase_name: string;
		chain_id: string;
		started_at?: string;
		ended_at?: string | null;
		outcome?: string | null;
	}>;
	chains?: Array<{
		chain_id: string;
		collab_id: string;
		status?: string;
		current_round?: number;
		max_rounds?: number;
		terminal_reason?: string | null;
	}>;
	handoffs?: Array<{
		handoff_id: string;
		chain_id: string;
		sender_agent: string;
		target_agent: string;
		request_text?: string;
		handback_text?: string | null;
		orchestrator_verdict?: string | null;
		round_number?: number | null;
		created_at?: string;
	}>;
}

/**
 * Builds a whisper-shaped state.db at dbPath. Schema is hand-rolled from the
 * read contract (NOT imported from whisper) so contract drift fails tests.
 * node:sqlite keeps the helper ABI-independent (same rationale as
 * make-cortex-fixture-db.ts).
 */
export function makeWhisperFixtureDb(
	dbPath: string,
	fx: WhisperFixture = {},
): void {
	mkdirSync(dirname(dbPath), { recursive: true });
	for (const suffix of ["", "-wal", "-shm"])
		rmSync(`${dbPath}${suffix}`, { force: true });

	const db = new DatabaseSync(dbPath);
	db.exec(`
		CREATE TABLE collab (
			collab_id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL,
			display_name TEXT NOT NULL, status TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
		);
		CREATE TABLE broker_daemon (
			collab_id TEXT PRIMARY KEY, host TEXT NOT NULL, port INTEGER NOT NULL,
			pid INTEGER, pid_start_time TEXT, started_at TEXT NOT NULL DEFAULT '',
			last_heartbeat_at TEXT NOT NULL, evaluator_status TEXT
		);
		CREATE TABLE session_binding (
			collab_id TEXT NOT NULL, agent_type TEXT NOT NULL,
			binding_state TEXT NOT NULL, active_session_id TEXT,
			binding_source TEXT, pending_claim_id TEXT,
			pending_claim_expires_at TEXT, updated_at TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (collab_id, agent_type)
		);
		CREATE TABLE workflows (
			workflow_id TEXT PRIMARY KEY, collab_id TEXT NOT NULL,
			workflow_type TEXT NOT NULL, name TEXT, spec_path TEXT NOT NULL DEFAULT '',
			role_bindings TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL,
			current_phase_index INTEGER NOT NULL, halt_reason TEXT,
			workflow_context TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
		);
		CREATE TABLE workflow_phases (
			phase_run_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL,
			phase_index INTEGER NOT NULL, phase_name TEXT NOT NULL,
			chain_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT '',
			ended_at TEXT, outcome TEXT
		);
		CREATE TABLE relay_chains (
			chain_id TEXT PRIMARY KEY, collab_id TEXT NOT NULL,
			status TEXT NOT NULL, current_round INTEGER NOT NULL,
			max_rounds INTEGER NOT NULL, terminal_handoff_id TEXT,
			terminal_reason TEXT, created_at TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL DEFAULT ''
		);
		CREATE TABLE relay_handoff (
			handoff_id TEXT PRIMARY KEY, collab_id TEXT NOT NULL DEFAULT '',
			sender_agent TEXT NOT NULL, target_agent TEXT NOT NULL,
			request_text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT '', last_activity_at TEXT NOT NULL DEFAULT '',
			chain_id TEXT, round_number INTEGER, handback_text TEXT,
			orchestrator_verdict TEXT
		);
	`);
	db.exec(`PRAGMA user_version = ${fx.schemaVersion ?? 6}`);

	const insert = (table: string, row: Record<string, unknown>) => {
		const keys = Object.keys(row);
		db.prepare(
			`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
		).run(...keys.map((k) => row[k] as never));
	};

	for (const c of fx.collabs ?? [])
		insert("collab", { display_name: "fixture", status: "active", ...c });
	for (const d of fx.daemons ?? [])
		insert("broker_daemon", { host: "127.0.0.1", port: 4500, pid: 999, ...d });
	for (const b of fx.bindings ?? []) insert("session_binding", { ...b });
	for (const w of fx.workflows ?? [])
		insert("workflows", {
			workflow_type: "spec-driven-development",
			status: "running",
			current_phase_index: 0,
			updated_at: "2026-06-12T00:00:00Z",
			...w,
		});
	for (const p of fx.phases ?? [])
		insert("workflow_phases", { started_at: "2026-06-12T00:00:00Z", ...p });
	for (const ch of fx.chains ?? [])
		insert("relay_chains", { status: "active", current_round: 1, max_rounds: 3, ...ch });
	for (const h of fx.handoffs ?? [])
		insert("relay_handoff", {
			request_text: "",
			created_at: "2026-06-12T00:00:00Z",
			...h,
		});
	db.close();
}
