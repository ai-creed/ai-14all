// tests/integration/xbp/peer-session.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createInMemoryPair,
	createNodeSodiumBackend,
	decodeFrame,
	encodeFrame,
	fromHex,
	generateIdentity,
	Peer,
	PROTOCOL_VERSION,
	sealAndSign,
	toHex,
	utf8,
	type Transport,
} from "@xavier/xbp/node";
import {
	sessionReportCapability,
	SESSION_CHANGED_TOPIC,
} from "@ai-creed/command-contract";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPeerSession } from "../../../services/xbp/xbp-peer-session";

// Build a paired host (XbpPeerSession) + client Peer over one in-memory pair, with a
// tap on the client's outbound frames so a test can replay/tamper the REAL request wire.
async function setupPairedSession() {
	const backend = await createNodeSodiumBackend();
	const [hostT, clientT] = createInMemoryPair();
	const audit = new XbpAuditSink({
		dir: mkdtempSync(join(tmpdir(), "xbp-ps-neg-")),
	});
	const hostIdentity = generateIdentity(backend);
	const clientIdentity = generateIdentity(backend);
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
	});
	session.attach(clientIdentity.sign.publicKey, clientIdentity.box.publicKey); // control:read granted

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
	client.start();
	return {
		backend,
		audit,
		hostIdentity,
		clientIdentity,
		hostNode,
		clientT,
		sentFrames,
		session,
		client,
	};
}

const rejectedReasons = (audit: XbpAuditSink) =>
	audit
		.entries()
		.filter((e) => e.outcome === "rejected")
		.map((e) => e.reason);

describe("XbpPeerSession (in-memory)", () => {
	it("serves a schema-valid session-report and delivers a coalesced session-changed event", async () => {
		const backend = await createNodeSodiumBackend();
		const [hostT, clientT] = createInMemoryPair();
		const audit = new XbpAuditSink({
			dir: mkdtempSync(join(tmpdir(), "xbp-ps-")),
		});
		const hostIdentity = generateIdentity(backend);
		const clientIdentity = generateIdentity(backend);

		const report = { mode: "ready", focus: null, sessions: [] } as const;
		const session = new XbpPeerSession({
			backend,
			identity: hostIdentity,
			transport: hostT,
			audit,
			getSessionReport: async () => report,
			coalesceMs: 10,
		});
		session.attach(clientIdentity.sign.publicKey, clientIdentity.box.publicKey);

		// Client peer (the phone's role).
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
		const events: string[] = [];
		client.onEvent((_from, topic) => events.push(topic));
		client.start();

		const got = await client.call(hostNode, sessionReportCapability, {});
		expect(got.mode).toBe("ready");

		session.notifyChanged();
		session.notifyChanged();
		await new Promise((r) => setTimeout(r, 40));
		expect(events.filter((t) => t === SESSION_CHANGED_TOPIC)).toHaveLength(1);

		session.stop();
	});

	it("re-pairing drops the previous peer: a second attach() stops the first peer", async () => {
		const backend = await createNodeSodiumBackend();
		const [hostT] = createInMemoryPair();
		const audit = new XbpAuditSink({
			dir: mkdtempSync(join(tmpdir(), "xbp-ps-reattach-")),
		});
		const hostIdentity = generateIdentity(backend);
		const phoneA = generateIdentity(backend);
		const phoneB = generateIdentity(backend);
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
		});

		// Pair phone A, then capture the live Peer instance and spy its stop().
		session.attach(phoneA.sign.publicKey, phoneA.box.publicKey);
		const internals = session as unknown as {
			peer: { stop: () => void };
			phoneNode: string;
		};
		const firstPeer = internals.peer;
		const firstNode = internals.phoneNode;
		const stopSpy = vi.spyOn(firstPeer, "stop");

		// Re-pair with phone B: the previous peer must be stopped and discarded so
		// phone A's Peer is no longer subscribed/authorized on the transport.
		session.attach(phoneB.sign.publicKey, phoneB.box.publicKey);

		expect(stopSpy).toHaveBeenCalledTimes(1);
		// The session now points at a brand-new peer bound to phone B's node.
		expect(internals.peer).not.toBe(firstPeer);
		expect(internals.phoneNode).not.toBe(firstNode);

		session.stop();
	});

	it("rejects an unauthorized session-report call (peer lacks control:read) and audits permission-denied", async () => {
		const backend = await createNodeSodiumBackend();
		const [hostT, clientT] = createInMemoryPair();
		const audit = new XbpAuditSink({
			dir: mkdtempSync(join(tmpdir(), "xbp-ps-unauth-")),
		});
		const hostIdentity = generateIdentity(backend);
		const clientIdentity = generateIdentity(backend);
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
		});
		session.attach(
			clientIdentity.sign.publicKey,
			clientIdentity.box.publicKey,
			[],
		); // NO permission granted

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

		await expect(
			client.call(hostNode, sessionReportCapability, {}),
		).rejects.toBeTruthy();
		await new Promise((r) => setTimeout(r, 10));
		expect(
			audit
				.entries()
				.some(
					(e) => e.outcome === "rejected" && e.reason === "permission-denied",
				),
		).toBe(true);
		session.stop();
	});

	it("returns an error (never crashes the service) and audits handler-error when the handler throws", async () => {
		const backend = await createNodeSodiumBackend();
		const [hostT, clientT] = createInMemoryPair();
		const audit = new XbpAuditSink({
			dir: mkdtempSync(join(tmpdir(), "xbp-ps-throw-")),
		});
		const hostIdentity = generateIdentity(backend);
		const clientIdentity = generateIdentity(backend);
		const session = new XbpPeerSession({
			backend,
			identity: hostIdentity,
			transport: hostT,
			audit,
			getSessionReport: async () => {
				throw new Error("boom");
			},
		});
		session.attach(clientIdentity.sign.publicKey, clientIdentity.box.publicKey); // default control:read

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

		await expect(
			client.call(hostNode, sessionReportCapability, {}),
		).rejects.toBeTruthy();
		await new Promise((r) => setTimeout(r, 10));
		expect(
			audit
				.entries()
				.some((e) => e.outcome === "rejected" && e.reason === "handler-error"),
		).toBe(true);
		session.stop();
	});

	it("rejects + audits a replayed request frame on the live Peer path", async () => {
		const { audit, hostNode, clientT, sentFrames, client, session } =
			await setupPairedSession();
		await client.call(hostNode, sessionReportCapability, {}); // legit call — the tap captures the request frame
		const requestFrame = sentFrames[sentFrames.length - 1];
		await clientT.send(requestFrame); // resend identical bytes (same nonce)
		await new Promise((r) => setTimeout(r, 10));
		expect(rejectedReasons(audit)).toContain("nonce-reused");
		session.stop();
	});

	it("rejects + audits a tampered (corrupted-seal) frame on the live Peer path", async () => {
		const { audit, hostNode, clientT, sentFrames, client, session } =
			await setupPairedSession();
		await client.call(hostNode, sessionReportCapability, {});
		const frame = decodeFrame(sentFrames[sentFrames.length - 1]);
		if (!frame || frame.t !== "addressed")
			throw new Error("expected an addressed frame");
		const sealed = fromHex(frame.payload);
		sealed[0] ^= 0xff; // corrupt the sealed ciphertext; the addressed header stays valid
		await clientT.send(encodeFrame({ ...frame, payload: toHex(sealed) }));
		await new Promise((r) => setTimeout(r, 10));
		expect(rejectedReasons(audit)).toContain("decrypt-failed");
		session.stop();
	});

	it("rejects + audits a forged-signature frame on the live Peer path", async () => {
		const { backend, audit, hostIdentity, hostNode, clientT, client, session } =
			await setupPairedSession();
		const attacker = generateIdentity(backend);
		// Seal validly to the host (so decrypt succeeds) but sign with the ATTACKER key.
		// `from` is the legit phone's nodeId, so the host verifies the signature against the
		// phone's sign key and the forgery is caught as bad-signature.
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
		session.stop();
	});
});
