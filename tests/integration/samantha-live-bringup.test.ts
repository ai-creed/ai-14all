import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
	spawnSamanthaHeadless,
	type SamanthaChild,
} from "./fixtures/spawn-samantha-headless";
import { createSamanthaConnectorClient } from "../../services/plugins/samantha/samantha-connector-client";
import { createActingTokenVerifier } from "../../services/plugins/samantha/acting-token-verifier";
import { createSamanthaDriver } from "../../services/plugins/samantha/samantha-driver";
import type { WebSocketCtor } from "../../services/plugins/samantha/samantha-command-client";
import type { SamanthaSessionSlice } from "../../shared/contracts/plugins";
import type { WorktreeIdentity } from "../../services/plugins/samantha/observe-types";
import type { ActingAuditEntry } from "../../services/diagnostics/acting-audit-logger";

// A minimal PluginContext: the driver only constructs against it; nothing here
// drives reportDegraded/reportLimited under the harness.
const PLUGIN_CTX = {
	reportDegraded: () => {},
	reportLimited: () => {},
};

let child: SamanthaChild | undefined;
let dir: string;
let tokenPath: string;
let auditLines: string[];
let actingEnabled: boolean;
let sentInputs: Array<{ sessionId: string; data: string }>;
let driver: ReturnType<typeof createSamanthaDriver> | undefined;
let stopDriver: (() => Promise<void>) | undefined;

// The single live worktree the harness exposes: its observe key is "a/b" (repo
// "a", branch "b"), with a live unmanaged session so instruct-session routes to
// send-input (the captured leaf effect) at a safe input point.
const WORKTREE_ID = "wt-ab";
const SESSION_ID = "sess-ab";

function identities(): Record<string, WorktreeIdentity> {
	return { [WORKTREE_ID]: { repo: "a", branch: "b", path: "/tmp/a-b" } };
}

// A slice with one unmanaged worktree in a SAFE-to-instruct attention ("waiting"
// is a safe input point AND maps to the speech-worthy attentionRequired signal,
// so it serves both the observe assertion and the real-act assertion).
function baselineSlice(): SamanthaSessionSlice {
	return {
		worktrees: [
			{
				worktreeId: WORKTREE_ID,
				provider: "claude",
				attention: "waiting",
				summary: "awaiting input",
				task: null,
				nextAction: null,
				updatedAt: 1,
				recent: [],
				sessionId: SESSION_ID,
			},
		],
		app: { focusedWorktreeId: WORKTREE_ID, mode: "ready" },
	};
}

// Drive a connector tool through Samantha's REAL merged tool-bridge (auto-approve
// confirmation) via the child RPC — NOT the raw HTTP command route — so
// connector-tools.ts + the confirmation path are exercised (spec harness contract).
// formatCommandResult shapes the McpToolResult: ok → JSON text + isError false;
// error → "<code>: <message>" text + isError true.
async function tool(
	capabilityId: string,
	args?: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
	const r = await child!.callTool(`conn__ai-14all__${capabilityId}`, args);
	return { isError: r.isError, text: r.content?.[0]?.text ?? "" };
}

async function getConnectors(): Promise<
	Array<{ id: string; summary: string; actingDisabled: boolean }>
> {
	const res = await fetch(`http://127.0.0.1:${child!.port}/connectors`);
	return res.json() as Promise<
		Array<{ id: string; summary: string; actingDisabled: boolean }>
	>;
}

// Starts the REAL ai-14all driver pointed at the Samantha child. Mirrors the
// option wiring in electron/main/index.ts (~lines 314–410): the real token
// verifier (reading the SAME file Samantha wrote), the real ActGuard chain via
// createSamanthaDriver, with test doubles ONLY for the leaf effects (sendInput
// capture, audit capture, the acting toggle, a one-entry worktree map). Returns
// once registered + listed in GET /connectors, with a baseline slice ingested.
async function startDriver(): Promise<void> {
	const actingTokenVerifier = createActingTokenVerifier({
		// Read the secret fresh on every verify (rotation tolerance), exactly as
		// electron/main/index.ts does; the child WROTE this file on boot.
		readSecret: () => {
			try {
				return readFileSync(tokenPath, "utf8").trim() || null;
			} catch {
				return null;
			}
		},
	});

	// Leaf effect: resolve the observe key "a/b" to a fake cwd (managed router).
	const resolveWorktreeRef = async (
		worktreeId: string,
	): Promise<{ workspaceId: string; cwd: string } | null> =>
		worktreeId === WORKTREE_ID ? { workspaceId: "w", cwd: "/tmp/a-b" } : null;

	const d = createSamanthaDriver({
		client: createSamanthaConnectorClient({ port: child!.port }),
		commandPort: child!.port,
		getIdentities: async () => identities(),
		getReviewCount: () => 0,
		getWhisperStates: async () => [],
		subscribeReviews: () => () => {},
		subscribeWorktrees: () => () => {},
		pushHealth: () => {},
		focusWorktree: () => {},
		webSocketImpl: WebSocket as unknown as WebSocketCtor,
		log: (message, error) => {
			if (process.env.SAMANTHA_HARNESS_DEBUG) console.error(message, error);
		},
		// ---- Real S3 chain (NOT stubbed): token verifier, ActGuard, dispatcher ----
		isActingEnabled: () => actingEnabled,
		verifyActingToken: (token) => actingTokenVerifier.verify(token),
		auditAct: (entry: ActingAuditEntry) =>
			auditLines.push(JSON.stringify(entry)),
		// Managed instructions resolve the worktree then "deliver" (captured).
		runManagedInstruction: async (worktreeId, decision) => {
			const ref = await resolveWorktreeRef(worktreeId);
			if (ref === null) return { ok: false, detail: "worktree not resolved" };
			const data =
				decision.kind === "collab-tell"
					? decision.instruction
					: decision.message;
			sentInputs.push({ sessionId: `managed:${worktreeId}`, data });
			return { ok: true, detail: "delivered" };
		},
		// Unmanaged send-input: the captured leaf effect (late-bound in main; here
		// always ready).
		sendUnmanagedInput: (sessionId, data) => {
			sentInputs.push({ sessionId, data });
			return { ok: true, detail: "sent" };
		},
	});

	driver = d;
	stopDriver = async () => {
		await d.stop();
	};

	await d.start(PLUGIN_CTX);
	// Seed a live unmanaged session so observe has a mapped signal and
	// instruct-session has a safe input point to route to.
	d.ingestSessionSlice(baselineSlice());

	// Poll until ai-14all has registered (HTTP) AND the command socket is bound,
	// so a tool call won't race the WS upgrade.
	await expect
		.poll(
			async () => (await getConnectors()).some((c) => c.id === "ai-14all"),
			{
				timeout: 10000,
				interval: 100,
			},
		)
		.toBe(true);
	// The first tool call exercises the WS command plane; give the socket a moment
	// to finish its upgrade after registration so the bridge has a bound socket.
	await expect
		.poll(
			async () => {
				const r = await child!.callTool("conn__ai-14all__session-report", {});
				return r.isError === false;
			},
			{ timeout: 10000, interval: 150 },
		)
		.toBe(true);
}

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "sam-live-"));
	tokenPath = join(dir, "connector-token");
	auditLines = [];
	actingEnabled = true;
	sentInputs = [];
	child = await spawnSamanthaHeadless({ tokenPath });
	// Samantha wrote the token on boot; ai-14all will read the same path.
	expect(existsSync(tokenPath)).toBe(true);
});

afterEach(async () => {
	await stopDriver?.();
	stopDriver = undefined;
	driver = undefined;
	await child?.stop();
	child = undefined;
	rmSync(dir, { recursive: true, force: true });
});

describe("live two-process bring-up", () => {
	it("registers with a compatible contractVersion and lists ai-14all (commanding enabled)", async () => {
		await startDriver();
		const list = await getConnectors();
		expect(list.some((c) => c.id === "ai-14all")).toBe(true);
		// A compatible contractVersion leaves commanding enabled (actingDisabled
		// would be true only on a version mismatch).
		expect(list.find((c) => c.id === "ai-14all")?.actingDisabled).toBe(false);
	});

	it("observe: a session-state change delivers a snapshot + a mapped event to Samantha", async () => {
		await startDriver();
		// startDriver already ingested a "waiting" slice (attentionRequired). Drive
		// another transition to force a fresh PATCH + event regardless of timing.
		driver!.ingestSessionSlice({
			...baselineSlice(),
			worktrees: [{ ...baselineSlice().worktrees[0], attention: "failed" }],
		});
		// Snapshot half: GET /connectors summary moves off the placeholder.
		await expect
			.poll(
				async () =>
					(await getConnectors()).find((c) => c.id === "ai-14all")?.summary,
				{ timeout: 10000 },
			)
			.not.toBe("Connected. Awaiting first snapshot.");
		// Event half: a mapped event reached Samantha (forwarded over the child RPC).
		await expect
			.poll(
				() =>
					child!.events.some((e) =>
						["attentionRequired", "error", "taskCompleted", "update"].includes(
							e.signal,
						),
					),
				{ timeout: 10000 },
			)
			.toBe(true);
	});

	it("benign round-trip through the tool-bridge: session-report returns ok (not a timeout)", async () => {
		await startDriver();
		const r = await tool("session-report");
		expect(r.isError).toBe(false);
	});

	it("real act through the tool-bridge: instruct-session (auto-approved) authorizes, audits, delivers", async () => {
		await startDriver();
		const r = await tool("instruct-session", {
			worktree: "a/b",
			instruction: "run the tests",
		});
		expect(r.isError).toBe(false); // delivery ACK through the merged registry + confirmation
		expect(auditLines.some((l) => l.includes('"phase":"result"'))).toBe(true);
		expect(sentInputs.length).toBeGreaterThan(0);
	});

	it("error forward-compat: acting-disabled (toggle off) surfaces through the bridge, not a timeout", async () => {
		actingEnabled = false;
		await startDriver();
		const r = await tool("instruct-session", {
			worktree: "a/b",
			instruction: "go",
		});
		expect(r.isError).toBe(true);
		expect(r.text).toMatch(/^acting-disabled:/);
	});

	it("error forward-compat: unauthorized (token file holds the wrong secret) surfaces", async () => {
		// Corrupt what ai-14all reads so the ActGuard token check fails → unauthorized.
		// (Samantha stamped her in-memory secret on the frame; ai-14all reads this file.)
		await startDriver();
		writeFileSync(tokenPath, "not-the-real-secret", { mode: 0o600 });
		const r = await tool("instruct-session", {
			worktree: "a/b",
			instruction: "go",
		});
		expect(r.isError).toBe(true);
		expect(r.text).toMatch(/^unauthorized:/);
	});

	it("reconnects after a real driver restart and commands again through the bridge", async () => {
		await startDriver();
		await stopDriver?.();
		stopDriver = undefined;
		await startDriver(); // fresh driver, same Samantha child
		const r = await tool("session-report");
		expect(r.isError).toBe(false);
	});
});
