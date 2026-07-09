// tests/integration/xbp/pairing-helpers.ts
// Shared pairing scaffolding for host-service integration tests: a permissive
// secure-storage stub, a paired-client connector, and a full QR->SAS pairing
// driver against a live XbpHostService LAN listener.
import { expect, vi } from "vitest";
import {
	connectWebSocketClient,
	createNodeSodiumBackend,
	fromHex,
	Peer,
	ReferenceClient,
	type Identity,
} from "@xavier/xbp/node";
import type { XbpHostService } from "../../../services/xbp/xbp-host-service";

export const okStorage = {
	isEncryptionAvailable: () => true,
	encryptString: (s: string) => Buffer.from(s, "utf8"),
	decryptString: (b: Buffer) => b.toString("utf8"),
};

export async function connectPeer(
	port: number,
	phone: Identity,
	hostSignPubHex: string,
	hostBoxPubHex: string,
	opts?: { requestTimeoutMs?: number },
) {
	const backend = await createNodeSodiumBackend();
	const transport = await connectWebSocketClient(`ws://127.0.0.1:${port}`);
	const peer = new Peer({
		backend,
		identity: phone,
		transport,
		requestTimeoutMs: opts?.requestTimeoutMs,
	});
	const hostNode = peer.addPeer(
		fromHex(hostSignPubHex),
		fromHex(hostBoxPubHex),
		[],
	);
	peer.start();
	return { peer, hostNode, transport };
}

export async function pairPhone(
	svc: XbpHostService,
	port: number,
	phone: Identity,
) {
	const backend = await createNodeSodiumBackend();
	const offer = await svc.startPairing();
	const refClient = new ReferenceClient({ backend, identity: phone });
	const t = await connectWebSocketClient(`ws://127.0.0.1:${port}`);
	// A previous pairing on this same svc instance leaves lastSas set (it is
	// never cleared), so "not null" alone would pass instantly on a second
	// pairing before this device's frame is even processed. Wait for it to
	// actually change instead.
	const priorSas = svc.getStatus().sas;
	await t.send(refClient.buildPairRequest(offer.token));
	await vi.waitFor(() => {
		const sas = svc.getStatus().sas;
		expect(sas).not.toBeNull();
		expect(sas).not.toBe(priorSas);
	});
	expect(svc.confirmPairing(true)).toBe(true);
	await t.close();
	return offer;
}
