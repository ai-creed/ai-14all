// tests/integration/xbp/relay-wiring.test.ts
//
// Child-spec §7 "Wiring" proof, end-to-end over REAL WSS: the host runs its
// real relay-registration state machine (real `wsRelaySocket`) against a
// contract-conformant fake relay, then an incoming-session drives the host's
// REAL accept dial (`dialRelayAccept`, no test seams) into the SAME peer
// session that a LAN-paired phone talks to. A vendor Peer over the relay end of
// the accept socket then makes a capability call that resolves — that is the
// full off-LAN path landing in the shared transport seam.
//
// The fixture cert is self-signed; NODE_TLS_REJECT_UNAUTHORIZED is dropped for
// THIS test process only (restored in afterAll).
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createNodeSodiumBackend,
	fromHex,
	generateIdentity,
	Peer,
	type Transport,
} from "@xavier/xbp/node";
import { sessionReportCapability } from "@ai-creed/command-contract";
import { XbpHostService } from "../../../services/xbp/xbp-host-service";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { startFakeRelay } from "../../fixtures/fake-relay";
import { okStorage, pairPhone } from "./pairing-helpers";

// 16-byte accept token → 32 hex chars, the tokenHex the vendor relay schema
// pins. The host's RelayHostBound parse would reject anything shorter.
const TOKEN = "cd".repeat(16);

const PRIOR_TLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
afterAll(() => {
	if (PRIOR_TLS === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
	else process.env.NODE_TLS_REJECT_UNAUTHORIZED = PRIOR_TLS;
});

let svc: XbpHostService | undefined;
let relay: Awaited<ReturnType<typeof startFakeRelay>> | undefined;
let peer: Peer | undefined;
afterEach(async () => {
	peer?.stop();
	peer = undefined;
	await svc?.stop();
	svc = undefined;
	await relay?.close();
	relay = undefined;
});

describe("XBP relay wiring (real WSS)", () => {
	it("incoming-session → real accept dial → attach → paired-peer capability over relay", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-relay-wiring-"));
		relay = await startFakeRelay();

		svc = new XbpHostService({
			dir,
			secureStorage: okStorage,
			getSessionReport: async () => ({
				mode: "ready",
				focus: null,
				sessions: [],
			}),
			subscribeChanges: () => () => {},
			initialRelayBaseUrl: relay.baseUrl,
		});
		const { port } = await svc.start();

		// The real state machine + real ws adapter just spoke real `t`-frames over
		// WSS to the fixture, which accepted registration.
		await vi.waitFor(() => expect(svc!.getStatus().relay).toBe("registered"));

		// Pair a phone over LAN — this attaches the phone's keys to the peer
		// session the relay accept dial will feed.
		const backend = await createNodeSodiumBackend();
		const phone = generateIdentity(backend);
		const offer = await pairPhone(svc, port!, phone);

		// Push an incoming-session; the host's REAL accept dial must hit
		// /accept/<TOKEN>. waitForAccept resolving is the proof.
		relay.pushIncomingSession(TOKEN);
		const relayEnd = await relay.waitForAccept(TOKEN);

		// Drive the phone side over the relay end of the accept socket with a
		// vendor Peer — mirrors pairing-helpers.connectPeer but with an inline
		// Transport over relayEnd instead of a LAN ws.
		const transport: Transport = {
			send: async (frame) => relayEnd.send(frame),
			onFrame: (handler) => {
				const listener = (d: unknown) => handler(new Uint8Array(d as Buffer));
				relayEnd.on("message", listener);
				return () => relayEnd.off("message", listener);
			},
			close: async () => relayEnd.close(),
		};
		peer = new Peer({ backend, identity: phone, transport });
		const hostNode = peer.addPeer(
			fromHex(offer.signPubHex),
			fromHex(offer.boxPubHex),
			[],
		);
		peer.start();

		// The full relay path into the SAME peer session: the call resolves ok.
		await expect(
			peer.call(hostNode, sessionReportCapability, {}),
		).resolves.toMatchObject({ mode: "ready" });

		// The accept-dial audit landed at info level.
		expect(new XbpAuditSink({ dir }).entries()).toContainEqual(
			expect.objectContaining({
				event: "relay-session-accepted",
				level: "info",
			}),
		);

		// Kill switch refuses capabilities over the relay leg too, WITHOUT touching
		// connectivity — the relay stays registered (Task 7 contract, relay leg).
		svc.setKillSwitch(true);
		await expect(
			peer.call(hostNode, sessionReportCapability, {}),
		).rejects.toThrow(); // AckError("handler-error")
		expect(svc.getStatus().relay).toBe("registered");
		expect(
			new XbpAuditSink({ dir })
				.entries()
				.some(
					(e) =>
						e.cap === sessionReportCapability.id &&
						e.outcome === "rejected" &&
						e.reason === "kill-switch",
				),
		).toBe(true);
	});
});
