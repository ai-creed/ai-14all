// tests/integration/xbp/pty-input-lifecycle.test.ts
//
// Real-dispatch integration coverage for the XBP PTY-input feature (child spec
// §6, umbrella §5.3/§9). Every scenario drives the single pty-input capability
// through the SAME production seam the desktop uses: a real
// createXbpPtyInputExecutor injected into a real XbpPeerSession (exactly as
// XbpHostService.start() wires it via the `ptyInput` option), a real Peer
// client over an in-memory transport, and a real TerminalService whose
// `writeIfLive` is the atomic liveness gate. The executor's `resolvePty` reads
// the real PtyInspectService catalog and its `writeIfLive` calls the real
// TerminalService, so nothing hand-wires bytes past the production dispatch:
// these tests fail if the desktop composition ever stops exposing pty-input.
//
// The mirrors hook mirrors production ipc.ts EXACTLY —
// `onExit: (id) => void catalog.handleTerminalExit(id)` — so scenario 7 can
// exercise the real exit ordering: TerminalService deletes its session
// synchronously (writeIfLive → false) while the catalog's `live` flag still
// lags true through the mirror drain window.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IPty } from "node-pty";
import {
	createInMemoryPair,
	createNodeSodiumBackend,
	encodeFrame,
	generateIdentity,
	Peer,
	PROTOCOL_VERSION,
	sealAndSign,
	toHex,
	utf8,
} from "@xavier/xbp/node";
import { ptyInputCapability } from "@ai-creed/command-contract";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPeerSession } from "../../../services/xbp/xbp-peer-session";
import { NEW_PAIRING_GRANTS } from "../../../services/xbp/xbp-grants";
import { createXbpPtyInputExecutor } from "../../../services/xbp/xbp-pty-input-executor";
import { PtyInspectService } from "../../../services/pty-inspect/pty-inspect-service";
import { TerminalService } from "../../../services/terminals/terminal-service";
import type { PtyMirror } from "../../../services/pty-inspect/pty-mirror";
import type { PtyInputAuditEntry } from "../../../services/diagnostics/pty-input-audit-logger";

// node-pty is a native module: mock it so `TerminalService.create()` spawns a
// deterministic double instead of a real login shell. The double's `write` spy
// is the observable end of the whole pty-input path; `kill` fires the exit
// handler synchronously so scenario 7 can open the real drain window.
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

// Copied from acting-lifecycle.test.ts: the protocol-layer rejection reasons the
// host's automatic XbpAuditSink recorded (schema-invalid / permission-denied /
// handler-error), distinct from the executor's semantic reject entries.
const rejectedReasons = (audit: XbpAuditSink) =>
	audit
		.entries()
		.filter((e) => e.outcome === "rejected")
		.map((e) => e.reason);

// helper for receiver-boundary scenarios: a validly signed + sealed frame
// whose args deliberately violate the pty-input schema. Client-side
// Peer.call() would refuse to send these, so the frame is built by hand.
async function sendRawPtyInputRequest(
	h: Harness,
	args: unknown,
): Promise<void> {
	const message = {
		v: PROTOCOL_VERSION,
		kind: "request",
		requestId: toHex(h.backend.randomBytes(16)),
		capabilityId: ptyInputCapability.id,
		args,
		nonce: toHex(h.backend.randomBytes(16)),
		ts: Date.now(),
	};
	const sealed = sealAndSign(
		h.backend,
		utf8(JSON.stringify(message)),
		h.clientIdentity.sign.privateKey,
		h.hostIdentity.box.publicKey,
	);
	await h.clientT.send(
		encodeFrame({
			t: "addressed",
			v: PROTOCOL_VERSION,
			to: h.hostNode,
			from: h.client.nodeId,
			payload: toHex(sealed),
		}),
	);
	await sleep(10);
}

type Harness = Awaited<ReturnType<typeof setupPtyInputSession>>;

// Build a paired host — a real createXbpPtyInputExecutor wired into a real
// XbpPeerSession through the production `ptyInput` seam — plus a real client
// Peer over one in-memory pair, plus a real TerminalService whose `writeIfLive`
// is the executor's atomic liveness gate and whose mirrors feed the catalog the
// executor resolves against. Mirrors setupInspectSession in
// pty-inspect-lifecycle.test.ts, extended for pty-input.
async function setupPtyInputSession(
	opts: { grants?: string[]; ptyInputEnabled?: boolean } = {},
) {
	const backend = await createNodeSodiumBackend();
	const [hostT, clientT] = createInMemoryPair();
	const audit = new XbpAuditSink({
		dir: mkdtempSync(join(tmpdir(), "xbp-pii-")),
	});
	const logsDir = mkdtempSync(join(tmpdir(), "pty-input-"));
	const hostIdentity = generateIdentity(backend);
	const clientIdentity = generateIdentity(backend);

	const resolveWorktree = vi.fn(async (worktreeId: string) =>
		worktreeId === "wt-1" ? { workspaceId: "ws-1", cwd: "/tmp/wt-1" } : null,
	);
	const ptyInspect = new PtyInspectService({ logsDir, resolveWorktree });

	// Real terminal service. The mirrors hook mirrors production ipc.ts wiring
	// EXACTLY: onExit fire-and-forgets catalog.handleTerminalExit(id), which
	// awaits the mirror drain before flipping the catalog's `live` flag — the
	// window scenario 7 dispatches into.
	const created: Array<{ id: string; mirror: PtyMirror }> = [];
	const ts = new TerminalService(
		{ onOutput: vi.fn(), onExit: vi.fn(), onState: vi.fn(), onError: vi.fn() },
		undefined,
		undefined,
		{
			onCreate: (id, mirror) => created.push({ id, mirror }),
			onExit: (id) => void ptyInspect.catalog.handleTerminalExit(id),
		},
	);
	ptyInspect.attachTerminalService(ts);

	// The host-side gate (child spec §3.1): settable so scenario 5 can disarm it.
	let ptyInputEnabled = opts.ptyInputEnabled ?? true;
	// One semantic entry per request (child spec §4) — apply | reject.
	const semantic: PtyInputAuditEntry[] = [];
	// The raw cause of an `internal` refusal is logged host-side only, never on
	// the wire (child spec §3.1 Bug-2 analogue). Scenario 8 asserts the split.
	const internalLogs: string[] = [];
	const ptyInput = createXbpPtyInputExecutor({
		isPtyInputEnabled: () => ptyInputEnabled,
		resolvePty: (worktreeId, agentId) => {
			const entry = ptyInspect.catalog.getEntry(worktreeId, agentId);
			return entry ? { terminalSessionId: entry.terminalSessionId } : undefined;
		},
		writeIfLive: (terminalSessionId, data) =>
			ts.writeIfLive(terminalSessionId, data),
		auditPtyInput: (e) => semantic.push(e),
		logInternal: (detail) => internalLogs.push(detail),
	});

	const session = new XbpPeerSession({
		backend,
		identity: hostIdentity,
		transport: hostT,
		audit,
		getSessionReport: async () => ({
			mode: "ready",
			focus: null,
			sessions: [],
		}),
		ptyInspect,
		ptyInput,
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
	client.start();

	// Publish an agent PTY exactly as the renderer does: spawn a terminal, then
	// upsert its (worktreeId, agentId) so the catalog adopts the from-birth
	// mirror and getEntry resolves. Returns the pty double whose `write` spy is
	// the observable write surface.
	const seedAgent = (o: {
		worktreeId?: string;
		agentId: string;
		provider?: string;
		label?: string;
		live?: boolean;
	}) => {
		const worktreeId = o.worktreeId ?? "wt-1";
		const meta = ts.create("ws-1", worktreeId, "/tmp/wt-1");
		const ptyDouble = spawnMock.mock.results.at(-1)?.value as IPty;
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
		return {
			termId: meta.id,
			mirror: entry.mirror,
			ptyDouble,
			worktreeId,
			agentId: o.agentId,
		};
	};

	return {
		backend,
		audit,
		semantic,
		internalLogs,
		ptyInspect,
		catalog: ptyInspect.catalog,
		session,
		client,
		hostNode,
		clientIdentity,
		hostIdentity,
		clientT,
		ts,
		created,
		seedAgent,
		setPtyInputEnabled: (v: boolean) => {
			ptyInputEnabled = v;
		},
	};
}

beforeEach(() => {
	spawnMock.mockReset();
	spawnMock.mockImplementation(() => createPtyDouble());
});

afterEach(() => {
	vi.useRealTimers();
});

describe("XBP PTY input lifecycle (control:pty-write, real dispatch)", () => {
	it("apply: a granted phone's mixed chunk list lands as ONE ordered write; protocol accepted; single semantic apply entry with literal chunks", async () => {
		const h = await setupPtyInputSession();
		const { ptyDouble, worktreeId, agentId } = h.seedAgent({ agentId: "a1" });
		const chunks = [{ text: "y" }, { key: "enter" }, { key: "up" }];

		const res = await h.client.call(h.hostNode, ptyInputCapability, {
			worktreeId,
			agentId,
			chunks,
		});
		expect(res).toMatchObject({ ok: true });
		if (!res.ok) throw new Error("expected ok result"); // narrow for appliedAt
		expect(typeof res.appliedAt).toBe("number");

		// The three chunks concatenate into ONE contiguous write, in order:
		// "y" + CR (enter) + CSI-A (up). translatePtyInputChunks owns the bytes.
		expect(ptyDouble.write).toHaveBeenCalledTimes(1);
		expect(ptyDouble.write).toHaveBeenCalledWith("y\r\x1b[A");

		// Protocol audit: exactly one accepted entry carrying the high-risk cap.
		const accepted = h.audit.entries().filter((e) => e.outcome === "accepted");
		expect(accepted).toHaveLength(1);
		expect(accepted[0]).toMatchObject({
			cap: ptyInputCapability.id,
			risk: "high",
			outcome: "accepted",
		});

		// Semantic: exactly one apply entry carrying the LITERAL chunks.
		expect(h.semantic).toHaveLength(1);
		expect(h.semantic[0]).toMatchObject({
			channel: "xbp",
			capability: ptyInputCapability.id,
			worktreeId,
			agentId,
			route: "apply",
			rejectCode: null,
			chunks,
		});

		h.session.stop();
	});

	it("grant enforcement: a pairing WITHOUT control:pty-write is protocol-rejected (permission-denied) — call rejects, no semantic entry, no write", async () => {
		const h = await setupPtyInputSession({
			grants: NEW_PAIRING_GRANTS.filter((g) => g !== "control:pty-write"),
		});
		const { ptyDouble, worktreeId, agentId } = h.seedAgent({ agentId: "ng" });

		await expect(
			h.client.call(h.hostNode, ptyInputCapability, {
				worktreeId,
				agentId,
				chunks: [{ text: "hello" }],
			}),
		).rejects.toThrow();

		// Rejected at the permission gate BEFORE the handler runs: the executor
		// never sees the request, so no semantic entry and no byte written.
		expect(rejectedReasons(h.audit)).toContain("permission-denied");
		expect(h.audit.entries().filter((e) => e.outcome === "accepted")).toEqual(
			[],
		);
		expect(h.semantic).toEqual([]);
		expect(ptyDouble.write).not.toHaveBeenCalled();

		h.session.stop();
	});

	it("receiver-side malformed chunk (belt-and-braces beyond the xavier conformance suite): a raw both-fields {text,key} request is schema-invalid AT DISPATCH — no semantic entry, no write", async () => {
		const h = await setupPtyInputSession();
		const { ptyDouble, worktreeId, agentId } = h.seedAgent({ agentId: "mf" });

		// `{ text, key }` matches neither strict union member: zod rejects it at
		// the host's dispatch-time args.safeParse, before the handler.
		await sendRawPtyInputRequest(h, {
			worktreeId,
			agentId,
			chunks: [{ text: "continue", key: "enter" }],
		});

		expect(rejectedReasons(h.audit)).toContain("schema-invalid");
		expect(h.semantic).toEqual([]);
		expect(ptyDouble.write).not.toHaveBeenCalled();

		h.session.stop();
	});

	it("receiver-side control-byte smuggle (umbrella §9): a raw request whose {text} carries ETX / ESC / CR / NUL / DEL / C1 is schema-invalid AT DISPATCH — free text can never synthesize control bytes", async () => {
		const h = await setupPtyInputSession();
		const { ptyDouble, worktreeId, agentId } = h.seedAgent({ agentId: "cb" });

		// ETX (⌃C), ESC, CR (enter), NUL, DEL, and C1 CSI (0x9b). Each, wrapped in
		// otherwise-printable text, must be rejected by PtyText's control-class
		// regex at dispatch — free text can never bypass the phone's ⌃C confirm by
		// smuggling ETX (or a raw CSI via 0x9b). Built via String.fromCharCode so
		// no literal control byte ever appears in this source file.
		for (const code of [0x03, 0x1b, 0x0d, 0x00, 0x7f, 0x9b]) {
			await sendRawPtyInputRequest(h, {
				worktreeId,
				agentId,
				chunks: [{ text: `safe${String.fromCharCode(code)}safe` }],
			});
		}

		expect(
			rejectedReasons(h.audit).filter((r) => r === "schema-invalid"),
		).toHaveLength(6);
		expect(h.semantic).toEqual([]);
		expect(ptyDouble.write).not.toHaveBeenCalled();

		h.session.stop();
	});

	it("disarm: gate off → pty-input-disabled ridden back in the ack; protocol entry ACCEPTED; single semantic reject entry", async () => {
		const h = await setupPtyInputSession({ ptyInputEnabled: false });
		const { ptyDouble, worktreeId, agentId } = h.seedAgent({ agentId: "off" });

		const res = await h.client.call(h.hostNode, ptyInputCapability, {
			worktreeId,
			agentId,
			chunks: [{ text: "x" }],
		});
		expect(res).toMatchObject({ ok: false, code: "pty-input-disabled" });

		// The gate is checked FIRST, before any pty resolution/write. An executor
		// refusal is still a successful handler return → protocol dispatch is
		// ACCEPTED, not rejected.
		expect(
			h.audit.entries().filter((e) => e.outcome === "accepted"),
		).toHaveLength(1);
		expect(rejectedReasons(h.audit)).toEqual([]);
		expect(h.semantic).toHaveLength(1);
		expect(h.semantic[0]).toMatchObject({
			route: "reject",
			rejectCode: "pty-input-disabled",
			channel: "xbp",
			worktreeId,
			agentId,
		});
		expect(ptyDouble.write).not.toHaveBeenCalled();

		h.session.stop();
	});

	it("no-such-pty: unknown worktree/agent refuses before any write", async () => {
		const h = await setupPtyInputSession();
		// A decoy live agent proves the refusal is target-scoped, not a dead host.
		const decoy = h.seedAgent({ agentId: "present" });

		const res = await h.client.call(h.hostNode, ptyInputCapability, {
			worktreeId: "wt-1",
			agentId: "ghost",
			chunks: [{ text: "z" }, { key: "enter" }],
		});
		expect(res).toMatchObject({ ok: false, code: "no-such-pty" });

		// Structured refusal → protocol accepted; one semantic reject; the decoy's
		// PTY (and every PTY) is untouched.
		expect(
			h.audit.entries().filter((e) => e.outcome === "accepted"),
		).toHaveLength(1);
		expect(h.semantic).toHaveLength(1);
		expect(h.semantic[0]).toMatchObject({
			route: "reject",
			rejectCode: "no-such-pty",
			worktreeId: "wt-1",
			agentId: "ghost",
		});
		expect(decoy.ptyDouble.write).not.toHaveBeenCalled();

		h.session.stop();
	});

	it("drain-window liveness (Bug-1, real exit ordering): kill the PTY, dispatch inside the mirror-drain window while catalog.live is STILL true → no-live-agent, zero new writes", async () => {
		const h = await setupPtyInputSession();
		const { ptyDouble, worktreeId, agentId } = h.seedAgent({
			agentId: "drain",
		});

		// kill() fires onExit synchronously: TerminalService deletes its session
		// (so writeIfLive will return false) AND the mirrors hook fire-and-forgets
		// catalog.handleTerminalExit(id), which awaits mirror.drained() before
		// flipping live — so RIGHT NOW the catalog still reports live:true.
		ptyDouble.kill();
		expect(h.catalog.getEntry(worktreeId, agentId)?.live).toBe(true); // window open

		const res = await h.client.call(h.hostNode, ptyInputCapability, {
			worktreeId,
			agentId,
			chunks: [{ text: "late" }, { key: "enter" }],
		});
		// Liveness is decided by TerminalService.writeIfLive (the deleted session),
		// NOT the lagging catalog flag: the bytes are refused, none written.
		expect(res).toMatchObject({ ok: false, code: "no-live-agent" });
		expect(ptyDouble.write).not.toHaveBeenCalled();

		expect(h.semantic).toHaveLength(1);
		expect(h.semantic[0]).toMatchObject({
			route: "reject",
			rejectCode: "no-live-agent",
			worktreeId,
			agentId,
		});

		h.session.stop();
	});

	it("write failure: pty.write throws → internal with the fixed path-free message; single semantic reject entry (code internal) carrying literal chunks", async () => {
		const h = await setupPtyInputSession();
		const { ptyDouble, worktreeId, agentId } = h.seedAgent({ agentId: "eio" });
		const chunks = [{ text: "boom" }, { key: "enter" }];
		(ptyDouble.write as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("EIO /Users/x");
		});

		const res = await h.client.call(h.hostNode, ptyInputCapability, {
			worktreeId,
			agentId,
			chunks,
		});
		expect(res).toMatchObject({ ok: false, code: "internal" });
		if (res.ok) throw new Error("expected refusal");
		// The generic, bounded message crosses the wire; the raw cause never does.
		expect(res.message).toBe("internal error during pty-input");
		expect(res.message).not.toContain("/Users");
		expect(res.message).not.toContain("EIO");

		// The raw cause is logged host-side only (the boundary split).
		expect(h.internalLogs.some((l) => l.includes("EIO /Users/x"))).toBe(true);

		// One semantic reject entry, code internal, carrying the literal chunks.
		expect(h.semantic).toHaveLength(1);
		expect(h.semantic[0]).toMatchObject({
			route: "reject",
			rejectCode: "internal",
			worktreeId,
			agentId,
			chunks,
		});

		h.session.stop();
	});
});
