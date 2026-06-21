import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WhisperStoreReader } from "../../../services/plugins/whisper/whisper-store-reader";
import { makeWhisperFixtureDb } from "./helpers/make-whisper-fixture-db";

let dir: string;
let dbPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ofa-whisper-db-"));
	dbPath = join(dir, "state.db");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("WhisperStoreReader", () => {
	it("readSchemaVersion returns user_version", () => {
		makeWhisperFixtureDb(dbPath, { schemaVersion: 6 });
		expect(new WhisperStoreReader(dbPath).readSchemaVersion()).toBe(6);
	});

	it("returns null/empty for a missing db file", () => {
		const reader = new WhisperStoreReader(join(dir, "nope.db"));
		expect(reader.readSchemaVersion()).toBeNull();
		expect(reader.readCollabs()).toEqual([]);
	});

	it("refuses reads when user_version is unsupported", () => {
		makeWhisperFixtureDb(dbPath, {
			schemaVersion: 7,
			collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
		});
		const reader = new WhisperStoreReader(dbPath);
		expect(reader.readSchemaVersion()).toBe(7);
		expect(reader.readCollabs()).toEqual([]);
	});

	it("reads collabs, daemon row, and bindings", () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
			daemons: [{ collab_id: "c1", last_heartbeat_at: "2026-06-12T03:00:00Z" }],
			bindings: [
				{ collab_id: "c1", agent_type: "claude", binding_state: "bound" },
				{
					collab_id: "c1",
					agent_type: "ezio",
					binding_state: "pending_attach",
				},
			],
		});
		const reader = new WhisperStoreReader(dbPath);
		expect(reader.readCollabs()).toEqual([
			{
				collabId: "c1",
				workspaceRoot: "/w1",
				displayName: "fixture",
				status: "active",
			},
		]);
		expect(reader.readDaemon("c1")).toEqual({
			host: "127.0.0.1",
			port: 4500,
			pid: 999,
			lastHeartbeatAt: "2026-06-12T03:00:00Z",
		});
		expect(reader.readBindings("c1")).toEqual([
			{ agentType: "claude", bindingState: "bound" },
			{ agentType: "ezio", bindingState: "pending_attach" },
		]);
	});

	it("reads the active workflow with phases and round info", () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
			workflows: [
				{
					workflow_id: "wf1",
					collab_id: "c1",
					spec_path: "docs/specs/payments.md",
					status: "running",
					current_phase_index: 1,
				},
			],
			phases: [
				{
					phase_run_id: "p0",
					workflow_id: "wf1",
					phase_index: 0,
					phase_name: "planning",
					chain_id: "ch0",
					ended_at: "2026-06-12T01:00:00Z",
					outcome: "done",
				},
				{
					phase_run_id: "p1",
					workflow_id: "wf1",
					phase_index: 1,
					phase_name: "implementation",
					chain_id: "ch1",
				},
			],
			chains: [
				{ chain_id: "ch1", collab_id: "c1", current_round: 2, max_rounds: 3 },
			],
		});
		const reader = new WhisperStoreReader(dbPath);
		const wf = reader.readActiveWorkflow("c1");
		expect(wf).toMatchObject({
			workflowId: "wf1",
			specPath: "docs/specs/payments.md",
			status: "running",
			currentPhaseIndex: 1,
			phaseName: "implementation",
			currentChainId: "ch1",
			round: { current: 2, max: 3 },
			haltReason: null,
		});
	});

	describe("readEscalatedChain", () => {
		it("does NOT report an escalation when a newer chain superseded the escalated one (resumed workflow)", () => {
			// Repro: a halted phase's chain stays status='escalated' in whisper's
			// history; resuming spawns a newer chain that completes. The stale
			// escalation must not leak (it would mask the resumed workflow's status).
			makeWhisperFixtureDb(dbPath, {
				collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
				chains: [
					{
						chain_id: "old",
						collab_id: "c1",
						status: "escalated",
						terminal_reason: "halted: deferred work",
						updated_at: "2026-06-21T10:52:00Z",
					},
					{
						chain_id: "new",
						collab_id: "c1",
						status: "done",
						updated_at: "2026-06-21T11:44:00Z",
					},
				],
			});
			expect(
				new WhisperStoreReader(dbPath).readEscalatedChain("c1"),
			).toBeNull();
		});

		it("reports the escalation when the latest chain is escalated (still halted)", () => {
			makeWhisperFixtureDb(dbPath, {
				collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
				chains: [
					{
						chain_id: "older",
						collab_id: "c1",
						status: "done",
						updated_at: "2026-06-21T10:00:00Z",
					},
					{
						chain_id: "cur",
						collab_id: "c1",
						status: "escalated",
						terminal_reason: "needs human",
						updated_at: "2026-06-21T11:00:00Z",
					},
				],
			});
			expect(new WhisperStoreReader(dbPath).readEscalatedChain("c1")).toEqual({
				chainId: "cur",
				reason: "needs human",
			});
		});

		it("returns null when there are no chains", () => {
			makeWhisperFixtureDb(dbPath, {
				collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
			});
			expect(
				new WhisperStoreReader(dbPath).readEscalatedChain("c1"),
			).toBeNull();
		});

		it("returns null when the latest chain is running (older escalation is stale)", () => {
			makeWhisperFixtureDb(dbPath, {
				collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
				chains: [
					{
						chain_id: "esc",
						collab_id: "c1",
						status: "escalated",
						terminal_reason: "old",
						updated_at: "2026-06-21T10:00:00Z",
					},
					{
						chain_id: "run",
						collab_id: "c1",
						status: "active",
						updated_at: "2026-06-21T12:00:00Z",
					},
				],
			});
			expect(
				new WhisperStoreReader(dbPath).readEscalatedChain("c1"),
			).toBeNull();
		});

		it("scopes to the given collab", () => {
			makeWhisperFixtureDb(dbPath, {
				collabs: [
					{ collab_id: "c1", workspace_root: "/w1" },
					{ collab_id: "c2", workspace_root: "/w2" },
				],
				chains: [
					{
						chain_id: "c1cur",
						collab_id: "c1",
						status: "done",
						updated_at: "2026-06-21T10:00:00Z",
					},
					{
						chain_id: "c2esc",
						collab_id: "c2",
						status: "escalated",
						terminal_reason: "other",
						updated_at: "2026-06-21T12:00:00Z",
					},
				],
			});
			const reader = new WhisperStoreReader(dbPath);
			expect(reader.readEscalatedChain("c1")).toBeNull();
			expect(reader.readEscalatedChain("c2")).toEqual({
				chainId: "c2esc",
				reason: "other",
			});
		});

		it("falls back to 'escalated' when terminal_reason is null", () => {
			makeWhisperFixtureDb(dbPath, {
				collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
				chains: [
					{
						chain_id: "esc",
						collab_id: "c1",
						status: "escalated",
						terminal_reason: null,
						updated_at: "2026-06-21T11:00:00Z",
					},
				],
			});
			expect(new WhisperStoreReader(dbPath).readEscalatedChain("c1")).toEqual({
				chainId: "esc",
				reason: "escalated",
			});
		});
	});

	it("reads handoff history for a chain", () => {
		makeWhisperFixtureDb(dbPath, {
			handoffs: [
				{
					handoff_id: "h1",
					chain_id: "ch1",
					sender_agent: "claude",
					target_agent: "ezio",
					request_text: "review this",
					handback_text: "looks good",
					orchestrator_verdict: "approved",
					round_number: 1,
				},
			],
		});
		expect(new WhisperStoreReader(dbPath).readHandoffs("ch1")).toEqual([
			{
				handoffId: "h1",
				senderAgent: "claude",
				targetAgent: "ezio",
				requestText: "review this",
				handbackText: "looks good",
				orchestratorVerdict: "approved",
				roundNumber: 1,
				createdAt: "2026-06-12T00:00:00Z",
			},
		]);
	});

	it("returns empty results on a corrupt db instead of throwing", () => {
		writeFileSync(dbPath, "garbage", "utf8");
		const reader = new WhisperStoreReader(dbPath);
		expect(reader.readCollabs()).toEqual([]);
		expect(reader.readSchemaVersion()).toBeNull();
	});
});
