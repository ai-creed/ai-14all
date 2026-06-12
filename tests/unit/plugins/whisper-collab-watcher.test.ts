import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWhisperCollabWatcher } from "../../../services/plugins/whisper/whisper-collab-watcher";
import { WhisperStoreReader } from "../../../services/plugins/whisper/whisper-store-reader";
import { makeWhisperFixtureDb } from "./helpers/make-whisper-fixture-db";

let dir: string;
let dbPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ofa-collab-watch-"));
	dbPath = join(dir, "state.db");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-06-12T03:00:00Z");

function makeWatcher(resolve: (p: string) => Promise<string | null>) {
	const reader = new WhisperStoreReader(dbPath);
	return createWhisperCollabWatcher({
		reader,
		resolveWorktreeId: resolve,
		now: () => NOW,
		heartbeatStaleMs: 30_000,
	});
}

describe("createWhisperCollabWatcher", () => {
	it("joins collabs to worktrees and reports daemon liveness", async () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [
				{ collab_id: "c1", workspace_root: "/known" },
				{ collab_id: "c2", workspace_root: "/unknown" },
			],
			daemons: [{ collab_id: "c1", last_heartbeat_at: "2026-06-12T02:59:50Z" }],
			bindings: [
				{ collab_id: "c1", agent_type: "claude", binding_state: "bound" },
			],
		});
		const watcher = makeWatcher(async (p) => (p === "/known" ? "wt-1" : null));
		const states = await watcher.snapshot();
		expect(states).toHaveLength(1); // unknown workspace_root dropped
		expect(states[0]).toMatchObject({
			worktreeId: "wt-1",
			collabId: "c1",
			daemonAlive: true,
			bindings: [{ agentType: "claude", bindingState: "bound" }],
			workflow: null,
		});
	});

	it("stale heartbeat (>30s) means daemonAlive false", async () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [{ collab_id: "c1", workspace_root: "/known" }],
			daemons: [{ collab_id: "c1", last_heartbeat_at: "2026-06-12T02:58:00Z" }],
		});
		const watcher = makeWatcher(async () => "wt-1");
		expect((await watcher.snapshot())[0].daemonAlive).toBe(false);
	});

	it("missing daemon row means daemonAlive false", async () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [{ collab_id: "c1", workspace_root: "/known" }],
		});
		const watcher = makeWatcher(async () => "wt-1");
		expect((await watcher.snapshot())[0].daemonAlive).toBe(false);
	});

	it("includes the active workflow snapshot", async () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [{ collab_id: "c1", workspace_root: "/known" }],
			workflows: [
				{
					workflow_id: "wf1",
					collab_id: "c1",
					status: "halted",
					current_phase_index: 0,
					halt_reason: "max rounds exceeded",
				},
			],
			phases: [
				{
					phase_run_id: "p0",
					workflow_id: "wf1",
					phase_index: 0,
					phase_name: "implementation",
					chain_id: "ch1",
				},
			],
		});
		const watcher = makeWatcher(async () => "wt-1");
		const [state] = await watcher.snapshot();
		expect(state.workflow).toMatchObject({
			workflowId: "wf1",
			status: "halted",
			haltReason: "max rounds exceeded",
			phaseName: "implementation",
		});
	});

	it("includes handback history for the active workflow's chain (capped at 20)", async () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [{ collab_id: "c1", workspace_root: "/known" }],
			workflows: [
				{
					workflow_id: "wf1",
					collab_id: "c1",
					status: "running",
					current_phase_index: 0,
				},
			],
			phases: [
				{
					phase_run_id: "p0",
					workflow_id: "wf1",
					phase_index: 0,
					phase_name: "implementation",
					chain_id: "ch1",
				},
			],
			handoffs: Array.from({ length: 25 }, (_, i) => ({
				handoff_id: `h${i}`,
				chain_id: "ch1",
				sender_agent: "claude",
				target_agent: "ezio",
				request_text: `req ${i}`,
				created_at: `2026-06-12T00:00:${String(i).padStart(2, "0")}Z`,
			})),
		});
		const watcher = makeWatcher(async () => "wt-1");
		const [state] = await watcher.snapshot();
		expect(state.handoffs).toHaveLength(20); // last 20 retained
		expect(state.handoffs[0].handoffId).toBe("h5"); // dropped the oldest 5
		expect(state.handoffs.at(-1)?.handoffId).toBe("h24");
	});

	it("reports an empty handoff list when there is no active chain", async () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [{ collab_id: "c1", workspace_root: "/known" }],
		});
		const watcher = makeWatcher(async () => "wt-1");
		expect((await watcher.snapshot())[0].handoffs).toEqual([]);
	});

	it("surfaces an escalated chain as escalation", async () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [{ collab_id: "c1", workspace_root: "/known" }],
			chains: [
				{
					chain_id: "ch9",
					collab_id: "c1",
					status: "escalated",
					terminal_reason: "agents disagree on approach",
				},
			],
		});
		const watcher = makeWatcher(async () => "wt-1");
		expect((await watcher.snapshot())[0].escalation).toEqual({
			chainId: "ch9",
			reason: "agents disagree on approach",
		});
	});

	it("polling loop emits snapshots and stops cleanly", async () => {
		makeWhisperFixtureDb(dbPath, {
			collabs: [{ collab_id: "c1", workspace_root: "/known" }],
		});
		const watcher = makeWatcher(async () => "wt-1");
		const seen: unknown[] = [];
		watcher.onSnapshot((s) => seen.push(s));
		watcher.start(10);
		await new Promise((r) => setTimeout(r, 50));
		watcher.stop();
		const count = seen.length;
		expect(count).toBeGreaterThan(0);
		await new Promise((r) => setTimeout(r, 30));
		expect(seen.length).toBe(count); // no emissions after stop
	});
});
