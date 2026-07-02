// tests/integration/xbp/acting-lifecycle.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	type Transport,
} from "@xavier/xbp/node";
import {
	pauseSessionCapability,
	resumeSessionCapability,
	stopSessionCapability,
	sessionReportCapability,
	SESSION_CHANGED_TOPIC,
} from "@ai-creed/command-contract";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPeerSession } from "../../../services/xbp/xbp-peer-session";
import {
	createXbpActingExecutor,
	type ResolveResult,
} from "../../../services/xbp/xbp-acting-executor";
import type {
	WhisperCommand,
	WhisperCommandResult,
} from "../../../shared/contracts/plugins";
import {
	NEW_PAIRING_GRANTS,
	grantsForStoredDevice,
} from "../../../services/xbp/xbp-grants";
import type { ActingAuditEntry } from "../../../services/diagnostics/acting-audit-logger";
import { createActGuard } from "../../../services/plugins/samantha/act-guard";

const okRef = {
	workspaceId: "ws-1",
	worktreeId: "wt-1",
	workflowId: "wf-1",
	cwd: "/tmp/wt-1",
};

// Build a paired host (XbpPeerSession, wired with an XbpActingExecutor) + client Peer
// over one in-memory pair, with a tap on the client's outbound frames so a test can
// replay/tamper the REAL request wire. Mirrors peer-session.test.ts's setupPairedSession.
async function setupPairedSession(
	opts: {
		grants?: string[];
		isActingEnabled?: () => boolean;
		resolveWorkflow?: (worktreeId: string) => Promise<ResolveResult>;
		runWhisperCommand?: (
			command: WhisperCommand,
			cwd: string,
		) => Promise<WhisperCommandResult>;
	} = {},
) {
	const backend = await createNodeSodiumBackend();
	const [hostT, clientT] = createInMemoryPair();
	const audit = new XbpAuditSink({
		dir: mkdtempSync(join(tmpdir(), "xbp-al-")),
	});
	const hostIdentity = generateIdentity(backend);
	const clientIdentity = generateIdentity(backend);

	const semantic: ActingAuditEntry[] = [];
	const runSpy = vi.fn(
		opts.runWhisperCommand ??
			(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "" })),
	);
	const resolveSpy = vi.fn(
		opts.resolveWorkflow ?? (async () => ({ ok: true as const, ref: okRef })),
	);
	const acting = createXbpActingExecutor({
		isActingEnabled: opts.isActingEnabled ?? (() => true),
		resolveWorkflow: resolveSpy,
		runWhisperCommand: runSpy,
		auditAct: (e) => semantic.push(e),
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
		acting,
		coalesceMs: 10,
	});
	session.attach(
		clientIdentity.sign.publicKey,
		clientIdentity.box.publicKey,
		opts.grants ?? [...NEW_PAIRING_GRANTS],
	);

	const sentFrames: Uint8Array[] = [];
	const tappedClientT: Transport = {
		send: (f) => {
			sentFrames.push(f);
			return clientT.send(f);
		},
		onFrame: (h) => clientT.onFrame(h),
		close: () => clientT.close(),
	};
	const client = new Peer({
		backend,
		identity: clientIdentity,
		transport: tappedClientT,
	});
	const hostNode = client.addPeer(
		hostIdentity.sign.publicKey,
		hostIdentity.box.publicKey,
		[],
	);
	const events: string[] = [];
	client.onEvent((_from, topic) => events.push(topic));
	client.start();

	return {
		backend,
		audit,
		semantic,
		runSpy,
		resolveSpy,
		hostIdentity,
		clientIdentity,
		hostNode,
		clientT,
		sentFrames,
		session,
		client,
		events,
	};
}

const rejectedReasons = (audit: XbpAuditSink) =>
	audit
		.entries()
		.filter((e) => e.outcome === "rejected")
		.map((e) => e.reason);

describe("XbpPeerSession acting lifecycle (control:act)", () => {
	it("pause: success returns a LifecycleResult, fires one coalesced session-changed, and audits a protocol+semantic pair", async () => {
		const { audit, semantic, runSpy, hostNode, client, events, session } =
			await setupPairedSession();

		const res = await client.call(hostNode, pauseSessionCapability, {
			worktreeId: "wt-1",
		});
		expect(res).toMatchObject({
			ok: true,
			state: "paused",
			workflowId: "wf-1",
		});
		expect(runSpy).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "workflow-pause" }),
			"/tmp/wt-1",
		);

		await new Promise((r) => setTimeout(r, 40)); // coalesceMs: 10 in the harness
		expect(events.filter((t) => t === SESSION_CHANGED_TOPIC)).toHaveLength(1);
		expect(
			audit.entries().filter((e) => e.outcome === "accepted"),
		).toHaveLength(1);
		expect(semantic.map((e) => e.phase)).toEqual(["start", "result"]);

		session.stop();
	});

	it("resume: workflow-resume route with message:null, state running", async () => {
		const { runSpy, hostNode, client, session } = await setupPairedSession();

		const res = await client.call(hostNode, resumeSessionCapability, {
			worktreeId: "wt-1",
		});
		expect(res).toMatchObject({
			ok: true,
			state: "running",
			workflowId: "wf-1",
		});
		expect(runSpy).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "workflow-resume", message: null }),
			"/tmp/wt-1",
		);

		session.stop();
	});

	it("stop: workflow-cancel route, state stopped", async () => {
		const { runSpy, hostNode, client, session } = await setupPairedSession();

		const res = await client.call(hostNode, stopSessionCapability, {
			worktreeId: "wt-1",
		});
		expect(res).toMatchObject({
			ok: true,
			state: "stopped",
			workflowId: "wf-1",
		});
		expect(runSpy).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "workflow-cancel" }),
			"/tmp/wt-1",
		);

		session.stop();
	});

	it("returned refusal (no-live-agent): result carries the code, protocol audit still accepted, exactly one semantic reject entry, NO session-changed event", async () => {
		const { audit, semantic, hostNode, client, events, session } =
			await setupPairedSession({
				resolveWorkflow: async () => ({ ok: false, code: "no-live-agent" }),
			});

		const res = await client.call(hostNode, pauseSessionCapability, {
			worktreeId: "wt-1",
		});
		expect(res).toMatchObject({ ok: false, code: "no-live-agent" });
		expect(
			audit.entries().filter((e) => e.outcome === "accepted"),
		).toHaveLength(1);
		expect(semantic).toHaveLength(1);
		expect(semantic[0]).toMatchObject({
			phase: "result",
			route: "reject",
			rejectCode: "no-live-agent",
			channel: "xbp",
		});

		await new Promise((r) => setTimeout(r, 40));
		expect(events.filter((t) => t === SESSION_CHANGED_TOPIC)).toHaveLength(0);

		session.stop();
	});

	it("grant migration (decision 8): a legacy record (no grantedPermissions) keeps session-report OK but denies lifecycle; semantic stays empty", async () => {
		const legacyGrants = grantsForStoredDevice({
			signPubHex: "unused",
			boxPubHex: "unused",
			pairedAt: 1,
			// deliberately NO grantedPermissions — pre-2b.2 record
		});
		const { audit, semantic, hostNode, client, session } =
			await setupPairedSession({
				grants: legacyGrants,
			});

		await expect(
			client.call(hostNode, sessionReportCapability, {}),
		).resolves.toMatchObject({ mode: "ready" });

		await expect(
			client.call(hostNode, pauseSessionCapability, { worktreeId: "wt-1" }),
		).rejects.toThrow();

		const rejected = audit.entries().filter((e) => e.outcome === "rejected");
		expect(rejected).toHaveLength(1);
		expect(rejected[0].reason).toBe("permission-denied");
		expect(semantic).toEqual([]);

		session.stop();
	});

	it("stored-grant replay: a persisted NEW_PAIRING_GRANTS record authorizes acting after 'restart'", async () => {
		const replayedGrants = grantsForStoredDevice({
			signPubHex: "unused",
			boxPubHex: "unused",
			pairedAt: 1,
			grantedPermissions: [...NEW_PAIRING_GRANTS],
		});
		const { hostNode, client, session } = await setupPairedSession({
			grants: replayedGrants,
		});

		await expect(
			client.call(hostNode, pauseSessionCapability, { worktreeId: "wt-1" }),
		).resolves.toMatchObject({ ok: true, state: "paused" });

		session.stop();
	});

	it("replay negative: resending the captured pause request frame is rejected (protocol entry only, semantic unchanged)", async () => {
		const { audit, semantic, hostNode, clientT, sentFrames, client, session } =
			await setupPairedSession();

		await client.call(hostNode, pauseSessionCapability, { worktreeId: "wt-1" });
		const semanticAfterLegitCall = semantic.length;
		const requestFrame = sentFrames[sentFrames.length - 1];

		await clientT.send(requestFrame); // resend identical bytes (same nonce)
		await new Promise((r) => setTimeout(r, 10));

		expect(rejectedReasons(audit)).toContain("nonce-reused");
		expect(semantic).toHaveLength(semanticAfterLegitCall);

		session.stop();
	});

	it("forged negative: a forged-signature acting request never reaches the executor — one protocol rejected entry, semantic stays empty", async () => {
		const {
			backend,
			audit,
			semantic,
			hostIdentity,
			hostNode,
			clientT,
			client,
			session,
		} = await setupPairedSession();
		const attacker = generateIdentity(backend);
		// Seal validly to the host (so decrypt succeeds) but sign with the ATTACKER key.
		// `from` is the legit phone's nodeId, so the host verifies the signature against
		// the phone's sign key and the forgery is caught as bad-signature.
		const forgedInner = sealAndSign(
			backend,
			utf8("forged"),
			attacker.sign.privateKey,
			hostIdentity.box.publicKey,
		);
		const forged = encodeFrame({
			t: "addressed",
			v: PROTOCOL_VERSION,
			to: hostNode,
			from: client.nodeId,
			payload: toHex(forgedInner),
		});

		await clientT.send(forged);
		await new Promise((r) => setTimeout(r, 10));

		expect(rejectedReasons(audit)).toContain("bad-signature");
		expect(
			audit.entries().filter((e) => e.outcome === "rejected"),
		).toHaveLength(1);
		expect(semantic).toEqual([]);

		session.stop();
	});

	it("no-drift (decision 7): the samantha and xbp 'start' audit entries share an identical canonical key shape, differing only in channel", async () => {
		const samanthaEntries: ActingAuditEntry[] = [];
		const guard = createActGuard({
			verifyToken: () => true,
			isActingEnabled: () => true,
			execute: async () => ({ ok: true, detail: "done" }),
			audit: (e) => samanthaEntries.push(e),
		});
		await guard.run({
			token: "t",
			prepare: async () => ({
				ok: true,
				worktreeId: "wt-1",
				instruction: "do it",
				decision: {
					kind: "workflow-resume",
					workflowId: "wf-1",
					message: "go",
				},
			}),
		});
		const samanthaStart = samanthaEntries.find((e) => e.phase === "start");
		expect(samanthaStart).toBeDefined();

		const xbpEntries: ActingAuditEntry[] = [];
		const executor = createXbpActingExecutor({
			isActingEnabled: () => true,
			resolveWorkflow: async () => ({ ok: true, ref: okRef }),
			runWhisperCommand: async () => ({
				ok: true,
				exitCode: 0,
				stdout: "",
				stderr: "",
			}),
			auditAct: (e) => xbpEntries.push(e),
		});
		await executor.pause("wt-1");
		const xbpStart = xbpEntries.find((e) => e.phase === "start");
		expect(xbpStart).toBeDefined();

		expect(Object.keys(samanthaStart!).sort()).toEqual(
			Object.keys(xbpStart!).sort(),
		);
		expect(samanthaStart!.channel).toBe("samantha");
		expect(xbpStart!.channel).toBe("xbp");
	});
});
