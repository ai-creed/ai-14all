// tests/integration/xbp/pty-inspect-lifecycle.test.ts
//
// Real-dispatch integration coverage for the XBP PTY-inspect feature. Every
// scenario drives the four inspect capabilities through the SAME production
// seam the desktop uses: a real PtyInspectService injected into a real
// XbpPeerSession (exactly as XbpHostService.start() wires it), a real Peer
// client over an in-memory transport, and — for the terminal-path scenarios —
// a real TerminalService whose `mirrors` hook feeds the catalog through the
// production getMirror/takeMirror path. Nothing hand-wires a catalog or
// registry directly into the capabilities, so these tests fail if the desktop
// composition ever stops exposing inspect.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IPty } from "node-pty";
import {
	createInMemoryPair,
	createNodeSodiumBackend,
	generateIdentity,
	Peer,
} from "@xavier/xbp/node";
import {
	listPtysCapability,
	subscribePtyCapability,
	unsubscribePtyCapability,
	ptyRowsCapability,
	PTY_CHANGED_TOPIC,
	CONTROL_INSPECT,
	type PtyChangedEvent,
} from "@ai-creed/command-contract";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPeerSession } from "../../../services/xbp/xbp-peer-session";
import { NEW_PAIRING_GRANTS } from "../../../services/xbp/xbp-grants";
import { PtyInspectService } from "../../../services/pty-inspect/pty-inspect-service";
import { TerminalService } from "../../../services/terminals/terminal-service";
import type { PtyMirror } from "../../../services/pty-inspect/pty-mirror";
import {
	TERMINAL_SPAWN_COLS,
	TERMINAL_SPAWN_ROWS,
} from "../../../shared/constants/terminal-geometry";

// node-pty is a native module: mock it so `TerminalService.create()` spawns a
// deterministic double instead of a real login shell (the terminal-service
// unit suite uses the identical pattern). We never invoke the double's onData,
// so all PTY output in these tests is driven explicitly against the mirror —
// the same mirror object the catalog adopts via takeMirror().
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node-pty", () => ({ default: { spawn: spawnMock } }));

type ExitHandler = (event: { exitCode: number; signal?: number }) => void;

function createPtyDouble(): IPty {
	let exitHandler: ExitHandler | null = null;
	return {
		write: vi.fn(),
		resize: vi.fn(),
		kill: vi.fn(() => exitHandler?.({ exitCode: 0, signal: 15 })),
		onData: vi.fn(),
		onExit: vi.fn((handler: ExitHandler) => {
			exitHandler = handler;
		}),
	} as unknown as IPty;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ensure a mirror write has fully parsed before it is read: pullRows() awaits
// only the §2 reset barrier, never the write drain, so tests that write-then-
// pull must drain explicitly (in production the phone pulls long after the PTY
// wrote).
async function feed(mirror: PtyMirror, data: string): Promise<void> {
	mirror.write(data);
	await mirror.drained();
}

// Discriminated-union narrowing helper so `.rows`/`.cols`/`.ptys` are typed
// after asserting a capability returned its success branch.
function assertOk<T extends { ok: boolean }>(
	res: T,
): asserts res is Extract<T, { ok: true }> {
	if (!res.ok) {
		throw new Error(`expected ok result, got ${JSON.stringify(res)}`);
	}
}

// Build a paired host (real PtyInspectService wired into a real XbpPeerSession
// through the production seam) + a real client Peer over one in-memory pair,
// plus a real TerminalService whose mirrors feed the catalog. Mirrors
// setupPairedSession in acting-lifecycle.test.ts.
async function setupInspectSession(opts: { grants?: string[] } = {}) {
	const backend = await createNodeSodiumBackend();
	const [hostT, clientT] = createInMemoryPair();
	const audit = new XbpAuditSink({
		dir: mkdtempSync(join(tmpdir(), "xbp-pil-")),
	});
	const logsDir = mkdtempSync(join(tmpdir(), "pty-inspect-"));
	const hostIdentity = generateIdentity(backend);
	const clientIdentity = generateIdentity(backend);

	// The async resolveWorktreeRef stand-in (spec §3): "wt-1" resolves, anything
	// else is an unknown worktree.
	const resolveWorktree = vi.fn(async (worktreeId: string) =>
		worktreeId === "wt-1"
			? { workspaceId: "ws-1", cwd: "/tmp/wt-1" }
			: null,
	);
	const ptyInspect = new PtyInspectService({ logsDir, resolveWorktree });

	// Real terminal service + mirrors hook, wired to the catalog exactly as the
	// desktop does. `created` captures each from-birth mirror at onCreate time.
	const created: Array<{ id: string; mirror: PtyMirror }> = [];
	const ts = new TerminalService(
		{ onOutput: vi.fn(), onExit: vi.fn(), onState: vi.fn(), onError: vi.fn() },
		undefined,
		undefined,
		{
			onCreate: (id, mirror) => created.push({ id, mirror }),
			onExit: vi.fn(),
		},
	);
	ptyInspect.attachTerminalService(ts);

	const session = new XbpPeerSession({
		backend,
		identity: hostIdentity,
		transport: hostT,
		audit,
		getSessionReport: async () => ({ mode: "ready", focus: null, sessions: [] }),
		ptyInspect,
		coalesceMs: 10,
	});
	session.attach(
		clientIdentity.sign.publicKey,
		clientIdentity.box.publicKey,
		opts.grants ?? [...NEW_PAIRING_GRANTS],
	);

	const client = new Peer({
		backend,
		identity: clientIdentity,
		transport: clientT,
	});
	const hostNode = client.addPeer(
		hostIdentity.sign.publicKey,
		hostIdentity.box.publicKey,
		[],
	);
	const ptyEvents: Array<{ topic: string; payload: PtyChangedEvent }> = [];
	client.onEvent((_from, topic, payload) => {
		if (topic === PTY_CHANGED_TOPIC) {
			ptyEvents.push({ topic, payload: payload as PtyChangedEvent });
		}
	});
	client.start();

	// Publish an agent PTY exactly as the renderer does: spawn a terminal, then
	// upsert its (worktreeId, agentId) → the catalog adopts the from-birth
	// mirror via takeMirror(). Returns the live mirror the catalog now owns.
	const seedAgent = (o: {
		worktreeId?: string;
		agentId: string;
		provider?: string;
		label?: string;
		live?: boolean;
	}) => {
		const worktreeId = o.worktreeId ?? "wt-1";
		const meta = ts.create("ws-1", worktreeId, "/tmp/wt-1");
		ptyInspect.catalog.upsert({
			worktreeId,
			agentId: o.agentId,
			terminalSessionId: meta.id,
			provider: o.provider ?? "claude",
			label: o.label ?? "Agent",
			live: o.live ?? true,
			agentDetected: true,
		});
		const entry = ptyInspect.catalog.getEntry(worktreeId, o.agentId);
		if (!entry) throw new Error("seedAgent: catalog upsert produced no entry");
		return { termId: meta.id, mirror: entry.mirror, worktreeId, agentId: o.agentId };
	};

	return {
		backend,
		audit,
		ptyInspect,
		catalog: ptyInspect.catalog,
		session,
		client,
		hostNode,
		clientIdentity,
		hostIdentity,
		ptyEvents,
		ts,
		created,
		logsDir,
		resolveWorktree,
		seedAgent,
	};
}

beforeEach(() => {
	spawnMock.mockReset();
	spawnMock.mockImplementation(() => createPtyDouble());
});

afterEach(() => {
	vi.useRealTimers();
});

describe("XBP PTY inspect lifecycle (control:inspect, real dispatch)", () => {
	it("list-ptys → subscribe → pty-rows round-trips through real dispatch", async () => {
		const h = await setupInspectSession();
		const { mirror, agentId } = h.seedAgent({ agentId: "a1", label: "Claude" });

		const list = await h.client.call(h.hostNode, listPtysCapability, {
			worktreeId: "wt-1",
		});
		assertOk(list);
		expect(list.ptys).toHaveLength(1);
		expect(list.ptys[0]).toMatchObject({ agentId: "a1", live: true });

		const sub = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId,
		});
		assertOk(sub);
		// No resize in this scenario: subscribe ack cols reads the spawn constant.
		expect(sub.cols).toBe(TERMINAL_SPAWN_COLS);

		await feed(mirror, "hello world\r\n");
		const page = await h.client.call(h.hostNode, ptyRowsCapability, {
			worktreeId: "wt-1",
			agentId,
			cursor: null,
		});
		assertOk(page);
		// First unmounted pull reads the same spawn constant (spec §6.5).
		expect(page.cols).toBe(TERMINAL_SPAWN_COLS);
		expect(page.rows.map((r) => r.text).join("\n")).toContain("hello world");
		expect(page.cursor).toBeTruthy();
		expect(page.more).toBe(false);

		h.session.stop();
	});

	it("never-mounted geometry parity through the real terminal path (spec §6.5)", async () => {
		const h = await setupInspectSession();

		// ONE no-resize fixture over the real spawn→mirror→catalog→pull path.
		spawnMock.mockClear();
		const meta = h.ts.create("ws-1", "wt-1", "/tmp/wt-1");

		// (1) pty.spawn dimensions.
		expect(spawnMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Array),
			expect.objectContaining({
				cols: TERMINAL_SPAWN_COLS,
				rows: TERMINAL_SPAWN_ROWS,
			}),
		);

		// (2) from-birth mirror construction dimensions.
		const createdMirror = h.created.at(-1)?.mirror;
		expect(createdMirror?.cols).toBe(TERMINAL_SPAWN_COLS);
		expect(createdMirror?.rows).toBe(TERMINAL_SPAWN_ROWS);

		// Agent never mounted — publish into the catalog with NO resize anywhere.
		h.catalog.upsert({
			worktreeId: "wt-1",
			agentId: "geo",
			terminalSessionId: meta.id,
			provider: "claude",
			label: "Geo",
			live: true,
			agentDetected: true,
		});

		// (3) subscribe ack cols.
		const sub = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "geo",
		});
		assertOk(sub);
		expect(sub.cols).toBe(TERMINAL_SPAWN_COLS);

		// (4) first pty-rows cols.
		const page = await h.client.call(h.hostNode, ptyRowsCapability, {
			worktreeId: "wt-1",
			agentId: "geo",
			cursor: null,
		});
		assertOk(page);
		expect(page.cols).toBe(TERMINAL_SPAWN_COLS);

		h.session.stop();
	});

	it("refusals are structured with no stderr and fire no events (spec §3, 2b.2 guard)", async () => {
		const h = await setupInspectSession();

		// Known worktree, zero agents → legitimate empty list.
		const empty = await h.client.call(h.hostNode, listPtysCapability, {
			worktreeId: "wt-1",
		});
		expect(empty).toEqual({ ok: true, ptys: [] });

		// Unknown worktree → no-such-pty (the async resolver's null branch).
		const badWorktree = await h.client.call(h.hostNode, listPtysCapability, {
			worktreeId: "wt-unknown",
		});
		expect(badWorktree).toMatchObject({ ok: false, code: "no-such-pty" });

		// Unknown agent under a known worktree → no-such-pty.
		const before = h.ptyEvents.length;
		const badRows = await h.client.call(h.hostNode, ptyRowsCapability, {
			worktreeId: "wt-1",
			agentId: "ghost",
			cursor: null,
		});
		expect(badRows).toMatchObject({ ok: false, code: "no-such-pty" });

		// Refusals fire no events (house rule).
		await sleep(40);
		expect(h.ptyEvents.length).toBe(before);

		// Protocol dispatch is "accepted" (a structured refusal is a successful
		// handler return); the inspect audit carries the structured refusal with
		// the originating capability id.
		expect(
			h.audit
				.entries()
				.some((e) => e.cap === ptyRowsCapability.id && e.outcome === "accepted"),
		).toBe(true);
		const inspect = h.ptyInspect.audit.entries();
		expect(
			inspect.some(
				(e) =>
					e.op === "refusal" &&
					e.refusalCode === "no-such-pty" &&
					e.capability === ptyRowsCapability.id,
			),
		).toBe(true);
		expect(
			inspect.some(
				(e) =>
					e.op === "refusal" &&
					e.refusalCode === "no-such-pty" &&
					e.capability === listPtysCapability.id,
			),
		).toBe(true);

		h.session.stop();
	});

	it("pre-catalog output and resize appear in the first pull (spec §6.11)", async () => {
		const h = await setupInspectSession();

		const meta = h.ts.create("ws-1", "wt-1", "/tmp/wt-1");
		const mirror = h.ts.getMirror(meta.id);
		if (!mirror) throw new Error("expected a from-birth mirror");

		// Emit data + resize BEFORE the catalog upsert.
		await feed(mirror, "early boot line\r\n");
		h.ts.resize(meta.id, 132, 43);

		h.catalog.upsert({
			worktreeId: "wt-1",
			agentId: "pre",
			terminalSessionId: meta.id,
			provider: "claude",
			label: "Pre",
			live: true,
			agentDetected: true,
		});

		const sub = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "pre",
		});
		assertOk(sub);
		expect(sub.cols).toBe(132);

		const page = await h.client.call(h.hostNode, ptyRowsCapability, {
			worktreeId: "wt-1",
			agentId: "pre",
			cursor: null,
		});
		assertOk(page);
		expect(page.cols).toBe(132);
		expect(page.rows.map((r) => r.text).join("\n")).toContain("early boot line");

		h.session.stop();
	});

	it("exit drain: final chunk written, exit delivered before its callback — first retained pull has it (spec §6.14)", async () => {
		const h = await setupInspectSession();
		const { mirror, termId, agentId } = h.seedAgent({
			agentId: "exit",
			label: "Exit",
		});

		const sub = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId,
		});
		assertOk(sub);

		const before = h.ptyEvents.length;
		// Write the final chunk, then hand the exit straight to the catalog: the
		// drain barrier inside handleTerminalExit must complete before live flips
		// false and the single final hint fires.
		mirror.write("FINAL-DRAIN-ROW\r\n");
		await h.catalog.handleTerminalExit(termId);

		await vi.waitFor(() => expect(h.ptyEvents.length).toBe(before + 1), {
			timeout: 2000,
			interval: 20,
		});

		// Retained pull still serves, and it contains the final row.
		const page = await h.client.call(h.hostNode, ptyRowsCapability, {
			worktreeId: "wt-1",
			agentId,
			cursor: null,
		});
		assertOk(page);
		expect(page.rows.map((r) => r.text).join("\n")).toContain("FINAL-DRAIN-ROW");

		// list-ptys now reports the retained-but-dead terminal.
		const list = await h.client.call(h.hostNode, listPtysCapability, {
			worktreeId: "wt-1",
		});
		assertOk(list);
		expect(list.ptys.find((p) => p.agentId === agentId)?.live).toBe(false);

		// Exactly one exit-final-hint, and no more after the agent-exit teardown.
		expect(h.ptyEvents.length).toBe(before + 1);

		h.session.stop();
	});

	it("restart exit race, late ordering (spec §6.15a)", async () => {
		const h = await setupInspectSession();
		const first = h.seedAgent({ agentId: "race", label: "Race" });

		const sub = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "race",
		});
		assertOk(sub);
		const preEpochs: number[] = [sub.epoch];

		// A pre-rebind hint off the original terminal.
		await feed(first.mirror, "before restart\r\n");
		await vi.waitFor(() => expect(h.ptyEvents.length).toBeGreaterThan(0), {
			timeout: 2000,
			interval: 20,
		});
		preEpochs.push(...h.ptyEvents.map((e) => e.payload.epoch));
		const preCount = h.ptyEvents.length;

		// Bind the replacement terminal FIRST (atomic rebind), THEN deliver the
		// displaced terminal's delayed exit.
		const term2 = h.ts.create("ws-1", "wt-1", "/tmp/wt-1");
		h.catalog.upsert({
			worktreeId: "wt-1",
			agentId: "race",
			terminalSessionId: term2.id,
			provider: "claude",
			label: "Race",
			live: true,
			agentDetected: true,
		});
		const mirror2 = h.catalog.getEntry("wt-1", "race")?.mirror;
		if (!mirror2) throw new Error("expected rebound mirror");

		// Late exit of term-1 is terminal-ID-correlated → dropped as a no-op.
		await h.catalog.handleTerminalExit(first.termId);

		// Subscription survives the rebind: a write on the NEW mirror hints.
		await feed(mirror2, "after restart\r\n");
		await vi.waitFor(() => expect(h.ptyEvents.length).toBeGreaterThan(preCount), {
			timeout: 2000,
			interval: 20,
		});
		const postEpochs = h.ptyEvents.slice(preCount).map((e) => e.payload.epoch);

		// Entry stays live + enumerable.
		const list = await h.client.call(h.hostNode, listPtysCapability, {
			worktreeId: "wt-1",
		});
		assertOk(list);
		expect(list.ptys.find((p) => p.agentId === "race")?.live).toBe(true);

		// Rows read from the term-2 mirror (never the disposed term-1 rows).
		const page = await h.client.call(h.hostNode, ptyRowsCapability, {
			worktreeId: "wt-1",
			agentId: "race",
			cursor: null,
		});
		assertOk(page);
		const text = page.rows.map((r) => r.text).join("\n");
		expect(text).toContain("after restart");
		expect(text).not.toContain("before restart");

		// The rebound hint's epoch is strictly greater than every pre-rebind epoch.
		expect(Math.min(...postEpochs)).toBeGreaterThan(Math.max(...preEpochs));

		h.session.stop();
	});

	it("restart exit race, early ordering with intent (spec §6.15b)", async () => {
		// --- Early ordering: intent → exit (suppressed) → replacement upsert ---
		const h = await setupInspectSession();
		const first = h.seedAgent({ agentId: "early", label: "Early" });

		const sub = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "early",
		});
		assertOk(sub);

		// The renderer publishes a rebind intent before stopping the old terminal.
		h.catalog.rebindIntent("wt-1", "early");
		// The old exit fires while the intent is pending → publication suppressed.
		first.mirror.write("stale exit output\r\n");
		await h.catalog.handleTerminalExit(first.termId);

		let list = await h.client.call(h.hostNode, listPtysCapability, {
			worktreeId: "wt-1",
		});
		assertOk(list);
		expect(list.ptys.find((p) => p.agentId === "early")?.live).toBe(true);

		// Replacement upsert resolves the intent (dropping the deferred exit).
		const term2 = h.ts.create("ws-1", "wt-1", "/tmp/wt-1");
		h.catalog.upsert({
			worktreeId: "wt-1",
			agentId: "early",
			terminalSessionId: term2.id,
			provider: "claude",
			label: "Early",
			live: true,
			agentDetected: true,
		});
		const mirror2 = h.catalog.getEntry("wt-1", "early")?.mirror;
		if (!mirror2) throw new Error("expected rebound mirror");

		// Subscription alive throughout: a write on the new mirror hints.
		const preCount = h.ptyEvents.length;
		await feed(mirror2, "post rebind\r\n");
		await vi.waitFor(() => expect(h.ptyEvents.length).toBeGreaterThan(preCount), {
			timeout: 2000,
			interval: 20,
		});

		list = await h.client.call(h.hostNode, listPtysCapability, {
			worktreeId: "wt-1",
		});
		assertOk(list);
		expect(list.ptys.find((p) => p.agentId === "early")?.live).toBe(true);
		h.session.stop();

		// --- Intent-expiry variant: intent → exit → timeout with no rebind ---
		// Through the production seam PtyInspectService constructs its catalog with
		// no options, so the intent timeout is the real ~10s. All mirror I/O runs
		// on real timers; only the 10s intent timer (created by rebindIntent) is
		// advanced under fake timers, so no mirror drain or transport hop needs the
		// faked clock.
		const h2 = await setupInspectSession();
		const ex = h2.seedAgent({ agentId: "expire", label: "Expire" });
		const sub2 = await h2.client.call(h2.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "expire",
		});
		assertOk(sub2);
		await feed(ex.mirror, "final before expiry\r\n");
		// Let any tick/coalescer hint from that write settle on the real clock so
		// no real hint timer is in flight when we switch to fake timers.
		await sleep(300);

		vi.useFakeTimers();
		try {
			h2.catalog.rebindIntent("wt-1", "expire"); // arms the fake 10s timer
			await h2.catalog.handleTerminalExit(ex.termId); // deferred behind intent
			const before = h2.ptyEvents.length;

			// Advance past the intent timeout with no rebind: the deferred exit is
			// released → live flips false and the final hint fires.
			await vi.advanceTimersByTimeAsync(10_001);

			expect(h2.catalog.getEntry("wt-1", "expire")?.live).toBe(false);
			expect(h2.ptyEvents.length).toBe(before + 1);
		} finally {
			vi.useRealTimers();
		}
		h2.session.stop();
	});

	it("re-pair teardown drops the subscription with control:inspect present in new grants (spec §6.7)", async () => {
		const h = await setupInspectSession();
		const { mirror, agentId } = h.seedAgent({ agentId: "rp", label: "RePair" });

		const sub = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId,
		});
		assertOk(sub);

		// A REAL second attach() — the replacement path confirmPairing() drives.
		// attach() begins with detach("re-pair") → onRePair() → teardown("re-pair").
		h.session.attach(
			h.clientIdentity.sign.publicKey,
			h.clientIdentity.box.publicKey,
			[...NEW_PAIRING_GRANTS],
		);

		const teardowns = h.ptyInspect.audit
			.entries()
			.filter((e) => e.op === "teardown");
		expect(teardowns.some((e) => e.cause === "re-pair")).toBe(true);
		expect(teardowns.some((e) => e.cause === "peer-detach")).toBe(false);

		// The old subscription is gone: subsequent writes produce no hints.
		const before = h.ptyEvents.length;
		await feed(mirror, "after re-pair\r\n");
		await sleep(300);
		expect(h.ptyEvents.length).toBe(before);

		// control:inspect is present in the new-pairing grant set.
		expect(NEW_PAIRING_GRANTS).toContain(CONTROL_INSPECT);

		h.session.stop();
	});

	it("audit trail is complete and content-free across the scenario run", async () => {
		const h = await setupInspectSession();
		const SECRET = "SUPER-SECRET-ROW-9f3a";
		const a = h.seedAgent({ agentId: "aud-a", label: "A" });
		h.seedAgent({ agentId: "aud-b", label: "B" });

		// subscribe A, then serve a page carrying SECRET through real dispatch.
		const subA = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "aud-a",
		});
		assertOk(subA);
		await feed(a.mirror, `${SECRET}\r\n`);
		const page = await h.client.call(h.hostNode, ptyRowsCapability, {
			worktreeId: "wt-1",
			agentId: "aud-a",
			cursor: null,
		});
		assertOk(page);
		expect(page.rows.map((r) => r.text).join("\n")).toContain(SECRET); // sanity

		// subscribe B while A active → A is replaced.
		const subB = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "aud-b",
		});
		assertOk(subB);
		// unsubscribe B.
		const unsub = await h.client.call(h.hostNode, unsubscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "aud-b",
		});
		assertOk(unsub);
		// A structured refusal (unknown agent).
		const refusal = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "ghost",
		});
		expect(refusal).toMatchObject({ ok: false, code: "no-such-pty" });
		// Re-subscribe A so an active subscription exists at teardown time.
		const subAgain = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "aud-a",
		});
		assertOk(subAgain);
		// Teardown via a real re-pair.
		h.session.attach(
			h.clientIdentity.sign.publicKey,
			h.clientIdentity.box.publicKey,
			[...NEW_PAIRING_GRANTS],
		);

		const entries = h.ptyInspect.audit.entries();
		const ops = entries.map((e) => e.op);
		expect(ops).toContain("subscribe");
		expect(ops).toContain("replace");
		expect(ops).toContain("unsubscribe");
		expect(ops).toContain("teardown");
		expect(
			entries.some(
				(e) => e.op === "refusal" && e.refusalCode === "no-such-pty",
			),
		).toBe(true);

		// subscribe/replace entries carry subscribe-pty; unsubscribe entries carry
		// unsubscribe-pty (spec §4).
		for (const e of entries.filter(
			(e) => e.op === "subscribe" || e.op === "replace",
		)) {
			expect(e.capability).toBe(subscribePtyCapability.id);
		}
		for (const e of entries.filter((e) => e.op === "unsubscribe")) {
			expect(e.capability).toBe(unsubscribePtyCapability.id);
		}

		// capability:null is reserved for auto-teardown entries only.
		expect(
			entries.some((e) => e.op === "teardown" && e.capability === null),
		).toBe(true);
		for (const e of entries.filter((e) => e.op !== "teardown")) {
			expect(e.capability).not.toBeNull();
		}

		// Content-free: no serialized entry carries any row text.
		expect(JSON.stringify(entries)).not.toContain(SECRET);

		h.session.stop();
	});

	it("production seam: hints flow only after bindHintEmitter and stop on peer detach", async () => {
		const h = await setupInspectSession();
		const { mirror, agentId } = h.seedAgent({ agentId: "seam", label: "Seam" });

		const sub = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId,
		});
		assertOk(sub);

		// Hints flow through the XbpPeerSession-bound emitter to the phone node.
		await feed(mirror, "live output\r\n");
		await vi.waitFor(() => expect(h.ptyEvents.length).toBeGreaterThan(0), {
			timeout: 2000,
			interval: 20,
		});

		// A transport-level peer detach (plain detach()) tears the subscription
		// down as "peer-detach".
		h.session.detach();
		expect(
			h.ptyInspect.audit
				.entries()
				.filter((e) => e.op === "teardown")
				.some((e) => e.cause === "peer-detach"),
		).toBe(true);

		// No further hints for subsequent writes.
		const before = h.ptyEvents.length;
		await feed(mirror, "after detach\r\n");
		await sleep(300);
		expect(h.ptyEvents.length).toBe(before);

		h.session.stop();
	});

	it("renderer reload through the real seam: replayed upserts change nothing observable (spec §6.10)", async () => {
		const h = await setupInspectSession();
		const first = h.seedAgent({ agentId: "reload", label: "Reload" });

		const sub = await h.client.call(h.hostNode, subscribePtyCapability, {
			worktreeId: "wt-1",
			agentId: "reload",
		});
		assertOk(sub);
		await feed(first.mirror, "line one\r\n");
		const page1 = await h.client.call(h.hostNode, ptyRowsCapability, {
			worktreeId: "wt-1",
			agentId: "reload",
			cursor: null,
		});
		assertOk(page1);
		const epochBefore = page1.epoch;
		const mirrorBefore = h.catalog.getEntry("wt-1", "reload")?.mirror;

		// Replay the identical agentPtys upsert (same terminalSessionId), as the
		// App.tsx publisher does on mount after a renderer reload.
		h.catalog.upsert({
			worktreeId: "wt-1",
			agentId: "reload",
			terminalSessionId: first.termId,
			provider: "claude",
			label: "Reload",
			live: true,
			agentDetected: true,
		});
		const mirrorAfter = h.catalog.getEntry("wt-1", "reload")?.mirror;
		// Same mirror object → no rebind, no epoch reset.
		expect(mirrorAfter).toBe(mirrorBefore);

		// Subscription stays active: the next write still hints.
		const before = h.ptyEvents.length;
		if (!mirrorAfter) throw new Error("expected retained mirror");
		await feed(mirrorAfter, "line two\r\n");
		await vi.waitFor(() => expect(h.ptyEvents.length).toBeGreaterThan(before), {
			timeout: 2000,
			interval: 20,
		});

		// The next pull serves the delta with no epoch reset.
		const page2 = await h.client.call(h.hostNode, ptyRowsCapability, {
			worktreeId: "wt-1",
			agentId: "reload",
			cursor: page1.cursor,
		});
		assertOk(page2);
		expect(page2.epoch).toBe(epochBefore);
		expect(page2.rows.map((r) => r.text).join("\n")).toContain("line two");

		h.session.stop();
	});
});
