import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type {
	WhisperAgentBinding,
	WhisperHandoffEntry,
	WhisperWorkflowSnapshot,
} from "../../../shared/models/ecosystem-plugin.js";
import { SUPPORTED_DB_SCHEMA } from "./whisper-env-probe.js";

// First schema with collab.archived_at: purge archives a collab (keeps its
// ledger rows) and whisper hides archived collabs from every live path.
const ARCHIVED_AT_SCHEMA_VERSION = 8;

export type WhisperCollabRow = {
	collabId: string;
	workspaceRoot: string;
	displayName: string;
	status: string;
};

export type WhisperDaemonRow = {
	host: string;
	port: number;
	pid: number | null;
	lastHeartbeatAt: string;
};

export interface WhisperPhaseRow {
	phaseRunId: string;
	phaseIndex: number;
	phaseName: string;
	chainId: string | null;
	startedAt: string | null;
	endedAt: string | null;
	outcome: string | null;
}

export interface WhisperWorkflowRunRow {
	workflowId: string;
	collabId: string;
	workspaceRoot: string;
	workflowType: string;
	status: string;
	haltReason: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	phases: WhisperPhaseRow[];
}

/** Sole owner of ai-whisper's state.db read-contract knowledge. Read-only. */
export class WhisperStoreReader {
	constructor(private readonly dbPath: string) {}

	private open(): Database.Database | null {
		if (!existsSync(this.dbPath)) return null;
		try {
			const db = new Database(this.dbPath, {
				readonly: true,
				fileMustExist: true,
			});
			db.pragma("busy_timeout = 2000");
			return db;
		} catch {
			return null;
		}
	}

	/** Open + schema-gate; returns null when reads are not allowed. */
	private openChecked(): Database.Database | null {
		const db = this.open();
		if (!db) return null;
		try {
			const version = db.pragma("user_version", { simple: true }) as number;
			if (
				version < SUPPORTED_DB_SCHEMA.min ||
				version > SUPPORTED_DB_SCHEMA.max
			) {
				db.close();
				return null;
			}
			return db;
		} catch {
			db.close();
			return null;
		}
	}

	readSchemaVersion(): number | null {
		const db = this.open();
		if (!db) return null;
		try {
			return db.pragma("user_version", { simple: true }) as number;
		} catch {
			return null;
		} finally {
			db.close();
		}
	}

	readCollabs(): WhisperCollabRow[] {
		const db = this.openChecked();
		if (!db) return [];
		try {
			// Mirror whisper's live paths: skip archived collabs. Pre-v8 stores
			// have no archived_at column, so the filter is version-gated.
			const version = db.pragma("user_version", { simple: true }) as number;
			const liveOnly =
				version >= ARCHIVED_AT_SCHEMA_VERSION
					? " WHERE archived_at IS NULL"
					: "";
			return (
				db
					.prepare(
						`SELECT collab_id, workspace_root, display_name, status FROM collab${liveOnly}`,
					)
					.all() as Array<Record<string, unknown>>
			).map((r) => ({
				collabId: r.collab_id as string,
				workspaceRoot: r.workspace_root as string,
				displayName: r.display_name as string,
				status: r.status as string,
			}));
		} catch {
			return [];
		} finally {
			db.close();
		}
	}

	readDaemon(collabId: string): WhisperDaemonRow | null {
		const db = this.openChecked();
		if (!db) return null;
		try {
			const r = db
				.prepare(
					"SELECT host, port, pid, last_heartbeat_at FROM broker_daemon WHERE collab_id = ?",
				)
				.get(collabId) as Record<string, unknown> | undefined;
			if (!r) return null;
			return {
				host: r.host as string,
				port: r.port as number,
				pid: (r.pid as number | null) ?? null,
				lastHeartbeatAt: r.last_heartbeat_at as string,
			};
		} catch {
			return null;
		} finally {
			db.close();
		}
	}

	readBindings(collabId: string): WhisperAgentBinding[] {
		const db = this.openChecked();
		if (!db) return [];
		try {
			return (
				db
					.prepare(
						"SELECT agent_type, binding_state FROM session_binding WHERE collab_id = ? ORDER BY agent_type",
					)
					.all(collabId) as Array<Record<string, unknown>>
			).map((r) => ({
				agentType: r.agent_type as string,
				bindingState: r.binding_state as WhisperAgentBinding["bindingState"],
			}));
		} catch {
			return [];
		} finally {
			db.close();
		}
	}

	readActiveWorkflow(collabId: string): WhisperWorkflowSnapshot | null {
		const db = this.openChecked();
		if (!db) return null;
		try {
			const wf = db
				.prepare(
					`SELECT workflow_id, workflow_type, spec_path, status, current_phase_index, halt_reason, updated_at
					 FROM workflows WHERE collab_id = ?
					 ORDER BY updated_at DESC LIMIT 1`,
				)
				.get(collabId) as Record<string, unknown> | undefined;
			if (!wf) return null;
			const phase = db
				.prepare(
					`SELECT phase_name, chain_id FROM workflow_phases
					 WHERE workflow_id = ? AND phase_index = ?`,
				)
				.get(wf.workflow_id, wf.current_phase_index) as
				| Record<string, unknown>
				| undefined;
			let round: { current: number; max: number } | null = null;
			if (phase?.chain_id) {
				const chain = db
					.prepare(
						"SELECT current_round, max_rounds FROM relay_chains WHERE chain_id = ?",
					)
					.get(phase.chain_id) as Record<string, unknown> | undefined;
				if (chain)
					round = {
						current: chain.current_round as number,
						max: chain.max_rounds as number,
					};
			}
			return {
				workflowId: wf.workflow_id as string,
				workflowType: wf.workflow_type as string,
				specPath: (wf.spec_path as string | null) ?? "",
				status: wf.status as string,
				currentPhaseIndex: wf.current_phase_index as number,
				phaseName: (phase?.phase_name as string | undefined) ?? null,
				currentChainId: (phase?.chain_id as string | undefined) ?? null,
				round,
				haltReason: (wf.halt_reason as string | null) ?? null,
				updatedAt: wf.updated_at as string,
			};
		} catch {
			return null;
		} finally {
			db.close();
		}
	}

	readEscalatedChain(
		collabId: string,
	): { chainId: string; reason: string } | null {
		const db = this.openChecked();
		if (!db) return null;
		try {
			// Report an escalation ONLY when the collab's most-recent relay chain is
			// itself escalated. Resuming a halted workflow spawns a newer chain for the
			// same phase; the older chain keeps status='escalated' in whisper's history
			// (read-only contract), but it must NOT leak as a live escalation — that
			// would mask the resumed workflow's real status in the session card.
			const r = db
				.prepare(
					`SELECT chain_id, status, terminal_reason FROM relay_chains
					 WHERE collab_id = ?
					 ORDER BY updated_at DESC LIMIT 1`,
				)
				.get(collabId) as Record<string, unknown> | undefined;
			if (!r || r.status !== "escalated") return null;
			return {
				chainId: r.chain_id as string,
				reason: (r.terminal_reason as string | null) ?? "escalated",
			};
		} catch {
			return null;
		} finally {
			db.close();
		}
	}

	readHandoffs(chainId: string): WhisperHandoffEntry[] {
		const db = this.openChecked();
		if (!db) return [];
		try {
			return (
				db
					.prepare(
						`SELECT handoff_id, sender_agent, target_agent, request_text,
						        handback_text, orchestrator_verdict, round_number, created_at
						 FROM relay_handoff WHERE chain_id = ? ORDER BY created_at`,
					)
					.all(chainId) as Array<Record<string, unknown>>
			).map((r) => ({
				handoffId: r.handoff_id as string,
				senderAgent: r.sender_agent as string,
				targetAgent: r.target_agent as string,
				requestText: r.request_text as string,
				handbackText: (r.handback_text as string | null) ?? null,
				orchestratorVerdict: (r.orchestrator_verdict as string | null) ?? null,
				roundNumber: (r.round_number as number | null) ?? null,
				createdAt: r.created_at as string,
			}));
		} catch {
			return [];
		} finally {
			db.close();
		}
	}

	listCollabIds(): string[] {
		const db = this.openChecked();
		if (!db) return [];
		try {
			return (
				db
					.prepare("SELECT collab_id FROM collab ORDER BY collab_id")
					.all() as Array<Record<string, unknown>>
			).map((r) => r.collab_id as string);
		} catch {
			return [];
		} finally {
			db.close();
		}
	}

	/** Full workflow history (not just the latest run) for a collab, each with its
	 * phases. Pass `sinceUpdatedAt` (ISO) to read only runs that could have changed
	 * since a prior tick — a run whose `updated_at >= since` OR which has any phase
	 * with `started_at`/`ended_at >= since`. whisper's phase closes do not bump
	 * `workflows.updated_at`, so the phase-activity clause is required (spec §8.1).
	 * Absent or null → full read (back-compat). */
	readAllWorkflows(
		collabId: string,
		sinceUpdatedAt?: string | null,
	): WhisperWorkflowRunRow[] {
		const db = this.openChecked();
		if (!db) return [];
		try {
			const collab = db
				.prepare("SELECT workspace_root FROM collab WHERE collab_id = ?")
				.get(collabId) as Record<string, unknown> | undefined;
			if (!collab) return [];
			const wfRows = db
				.prepare(
					`SELECT w.workflow_id, w.collab_id, w.workflow_type, w.status, w.halt_reason, w.created_at, w.updated_at
					 FROM workflows w
					 WHERE w.collab_id = @collabId
					   AND (
					     @since IS NULL
					     OR w.updated_at >= @since
					     OR EXISTS (
					       SELECT 1 FROM workflow_phases p
					       WHERE p.workflow_id = w.workflow_id
					         AND (p.started_at >= @since OR p.ended_at >= @since)
					     )
					   )
					 ORDER BY w.created_at`,
				)
				.all({ collabId, since: sinceUpdatedAt ?? null }) as Array<
				Record<string, unknown>
			>;
			const phaseStmt = db.prepare(
				`SELECT phase_run_id, phase_index, phase_name, chain_id, started_at, ended_at, outcome
				 FROM workflow_phases WHERE workflow_id = ? ORDER BY phase_index, started_at`,
			);
			return wfRows.map((w) => ({
				workflowId: w.workflow_id as string,
				collabId: w.collab_id as string,
				workspaceRoot: collab.workspace_root as string,
				workflowType: w.workflow_type as string,
				status: w.status as string,
				haltReason: (w.halt_reason as string | null) ?? null,
				createdAt: (w.created_at as string | null) ?? null,
				updatedAt: (w.updated_at as string | null) ?? null,
				phases: (
					phaseStmt.all(w.workflow_id) as Array<Record<string, unknown>>
				).map((p) => ({
					phaseRunId: p.phase_run_id as string,
					phaseIndex: p.phase_index as number,
					phaseName: p.phase_name as string,
					chainId: (p.chain_id as string | null) ?? null,
					startedAt: (p.started_at as string | null) ?? null,
					endedAt: (p.ended_at as string | null) ?? null,
					outcome: (p.outcome as string | null) ?? null,
				})),
			}));
		} catch {
			return [];
		} finally {
			db.close();
		}
	}
}
