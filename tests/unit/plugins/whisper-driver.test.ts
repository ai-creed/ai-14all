import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import { createWhisperDriver } from "../../../services/plugins/whisper/whisper-driver";
import { makeWhisperFixtureDb } from "./helpers/make-whisper-fixture-db";

let dir: string;
let stateRoot: string;
let server: Server | null = null;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ofa-driver-"));
	stateRoot = join(dir, ".ai-whisper");
});

afterEach(async () => {
	if (server) await new Promise((r) => server?.close(r));
	server = null;
	rmSync(dir, { recursive: true, force: true });
});

function makeDriver(pushed: WhisperWorktreeState[][]) {
	return createWhisperDriver({
		getStateRoot: () => stateRoot,
		getBinary: async () => ({ command: "/bin/whisper", prefixArgs: [] }),
		probeImpl: async () => ({
			kind: "installed",
			version: "0.6.0",
			installPath: "/x",
			protocolVersion: "1",
		}),
		resolveWorktreeId: async () => "wt-1",
		pushState: (states) => pushed.push(states),
		pollIntervalMs: 20,
		now: () => Date.parse("2026-06-12T03:00:00Z"),
	});
}

const FRESH = "2026-06-12T02:59:55Z";

describe("createWhisperDriver", () => {
	it("probe() delegates to the injected probe", async () => {
		const driver = makeDriver([]);
		expect((await driver.probe()).kind).toBe("installed");
	});

	it("start() polls and pushes worktree states (polling mode)", async () => {
		makeWhisperFixtureDb(join(stateRoot, "state.db"), {
			collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
			daemons: [{ collab_id: "c1", last_heartbeat_at: FRESH }],
		});
		const pushed: WhisperWorktreeState[][] = [];
		const driver = makeDriver(pushed);
		const ctx = { reportDegraded: vi.fn(), reportLimited: vi.fn() };
		await driver.start(ctx);
		await new Promise((r) => setTimeout(r, 80));
		await driver.stop();
		expect(pushed.length).toBeGreaterThan(0);
		const last = pushed.filter((batch) => batch.length > 0).at(-1);
		expect(last?.[0]).toMatchObject({
			collabId: "c1",
			liveFeed: "polling",
		});
		expect(ctx.reportLimited).toHaveBeenCalledWith(true);
	});

	it("attaches the event socket when present (liveFeed socket)", async () => {
		makeWhisperFixtureDb(join(stateRoot, "state.db"), {
			collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
			daemons: [{ collab_id: "c1", last_heartbeat_at: FRESH }],
		});
		const socketDir = join(stateRoot, "sockets");
		mkdirSync(socketDir, { recursive: true });
		server = createServer((socket) => {
			socket.write(
				`${JSON.stringify({ type: "hello", engineVersion: "0.6.0", protocolVersion: "1" })}\n`,
			);
		});
		await new Promise<void>((r) =>
			server?.listen(join(socketDir, "events-c1.sock"), () => r()),
		);
		const pushed: WhisperWorktreeState[][] = [];
		const driver = makeDriver(pushed);
		const ctx = { reportDegraded: vi.fn(), reportLimited: vi.fn() };
		await driver.start(ctx);
		await new Promise((r) => setTimeout(r, 120));
		await driver.stop();
		const last = pushed.filter((batch) => batch.length > 0).at(-1);
		expect(last?.[0]).toMatchObject({ liveFeed: "socket" });
		expect(ctx.reportLimited).toHaveBeenCalledWith(false);
	});

	it("stop() ends pushes", async () => {
		makeWhisperFixtureDb(join(stateRoot, "state.db"), {
			collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
		});
		const pushed: WhisperWorktreeState[][] = [];
		const driver = makeDriver(pushed);
		await driver.start({ reportDegraded: vi.fn(), reportLimited: vi.fn() });
		await new Promise((r) => setTimeout(r, 50));
		await driver.stop();
		const count = pushed.length;
		await new Promise((r) => setTimeout(r, 50));
		expect(pushed.length).toBe(count);
	});

	it("re-snapshots when a worktree change is signaled, and unsubscribes on stop", async () => {
		makeWhisperFixtureDb(join(stateRoot, "state.db"), {
			collabs: [{ collab_id: "c1", workspace_root: "/w1" }],
			daemons: [{ collab_id: "c1", last_heartbeat_at: FRESH }],
		});
		const pushed: WhisperWorktreeState[][] = [];
		const listeners = new Set<() => void>();
		const emitWorktreeChange = () => {
			for (const cb of listeners) cb();
		};
		const driver = createWhisperDriver({
			getStateRoot: () => stateRoot,
			getBinary: async () => ({ command: "/bin/whisper", prefixArgs: [] }),
			probeImpl: async () => ({
				kind: "installed",
				version: "0.6.0",
				installPath: "/x",
				protocolVersion: "1",
			}),
			resolveWorktreeId: async () => "wt-1",
			pushState: (states) => pushed.push(states),
			// Long poll so the only refresh trigger under test is the change signal.
			pollIntervalMs: 60_000,
			now: () => Date.parse("2026-06-12T03:00:00Z"),
			subscribeWorktreeChanges: (cb) => {
				listeners.add(cb);
				return () => listeners.delete(cb);
			},
		});
		const ctx = { reportDegraded: vi.fn(), reportLimited: vi.fn() };
		await driver.start(ctx);
		await new Promise((r) => setTimeout(r, 30));
		const afterBoot = pushed.length;
		expect(afterBoot).toBeGreaterThan(0);

		// A worktree-registry change must force a fresh snapshot even though the
		// 60s poll has not fired — this is what makes a freshly-loaded worktree's
		// collab appear in the lens immediately.
		emitWorktreeChange();
		await new Promise((r) => setTimeout(r, 30));
		expect(pushed.length).toBeGreaterThan(afterBoot);

		// stop() must tear the subscription down so later signals do nothing.
		await driver.stop();
		const afterStop = pushed.length;
		emitWorktreeChange();
		await new Promise((r) => setTimeout(r, 30));
		expect(pushed.length).toBe(afterStop);
	});
});
