import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	connectWebSocketClient,
	createNodeSodiumBackend,
	fromHex,
	generateIdentity,
	Peer,
	ReferenceClient,
	toHex,
	type Identity,
} from "@xavier/xbp/node";
import {
	pauseSessionCapability,
	sessionReportCapability,
} from "@ai-creed/command-contract";
import { XbpHostService } from "../../../services/xbp/xbp-host-service";
import { XbpPairedDeviceStore } from "../../../services/xbp/xbp-paired-device-store";
import { NEW_PAIRING_GRANTS } from "../../../services/xbp/xbp-grants";
import type { XbpActingExecutor } from "../../../services/xbp/xbp-acting-executor";

const okStorage = {
	isEncryptionAvailable: () => true,
	encryptString: (s: string) => Buffer.from(s, "utf8"),
	decryptString: (b: Buffer) => b.toString("utf8"),
};

const okResult = {
	ok: true as const,
	worktreeId: "wt-1",
	workflowId: "wf-1",
	state: "paused" as const,
	appliedAt: "2026-07-02T00:00:00.000Z",
};

// Fake executor: `calls` doubles as the semantic-reach probe — if the grant
// gate holds, a denied device must leave it empty (executor never reached).
function fakeActing(): { acting: XbpActingExecutor; calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		acting: {
			pause: async () => (calls.push("pause"), okResult),
			resume: async () => (
				calls.push("resume"),
				{ ...okResult, state: "running" as const }
			),
			stop: async () => (
				calls.push("stop"),
				{ ...okResult, state: "stopped" as const }
			),
		},
	};
}

function makeService(dir: string, acting: XbpActingExecutor) {
	return new XbpHostService({
		dir,
		secureStorage: okStorage,
		getSessionReport: async () => ({
			mode: "ready",
			focus: null,
			sessions: [],
		}),
		subscribeChanges: () => () => {},
		acting,
	});
}

async function connectPeer(
	port: number,
	phone: Identity,
	hostSignPubHex: string,
	hostBoxPubHex: string,
) {
	const backend = await createNodeSodiumBackend();
	const transport = await connectWebSocketClient(`ws://127.0.0.1:${port}`);
	const peer = new Peer({ backend, identity: phone, transport });
	const hostNode = peer.addPeer(
		fromHex(hostSignPubHex),
		fromHex(hostBoxPubHex),
		[],
	);
	peer.start();
	// Peer.stop() only detaches the frame handler; it never closes the
	// underlying socket. The LAN host's WebSocketServer.close() (used by
	// XbpHostService.stop() in afterEach) waits for every live connection to
	// end before its callback fires, so the transport must be closed
	// explicitly or teardown hangs until the suite's hook timeout.
	return { peer, hostNode, transport };
}

let svc: XbpHostService | undefined;
afterEach(async () => {
	await svc?.stop();
	svc = undefined;
});

describe("XbpHostService grant migration (decision 8)", () => {
	it("re-attaches a pre-2b.2 persisted record read-only: session-report OK, lifecycle denied, executor untouched", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-mig-"));
		const phone = generateIdentity(backend);
		new XbpPairedDeviceStore({ dir, secureStorage: okStorage }).save({
			signPubHex: toHex(phone.sign.publicKey),
			boxPubHex: toHex(phone.box.publicKey),
			pairedAt: 1,
			// deliberately NO grantedPermissions — a record persisted before 2b.2
		});
		const { acting, calls } = fakeActing();
		svc = makeService(dir, acting);
		const { port } = await svc.start();
		const offer = await svc.startPairing(); // used only to learn the host's public keys
		const { peer, hostNode, transport } = await connectPeer(
			port!,
			phone,
			offer.signPubHex,
			offer.boxPubHex,
		);

		await expect(
			peer.call(hostNode, sessionReportCapability, {}),
		).resolves.toMatchObject({ mode: "ready" });
		await expect(
			peer.call(hostNode, pauseSessionCapability, { worktreeId: "wt-1" }),
		).rejects.toThrow(); // permission-denied at the Peer, pre-executor
		expect(calls).toEqual([]); // no silent upgrade: acting authority never minted
		peer.stop();
		await transport.close();
	});

	it("confirmPairing persists NEW_PAIRING_GRANTS; after restart the replayed grant authorizes acting", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-mig2-"));
		const phone = generateIdentity(backend);
		const { acting, calls } = fakeActing();
		svc = makeService(dir, acting);
		const { port } = await svc.start();
		const offer = await svc.startPairing();

		// Drive the REAL pairing exchange over the live LAN transport.
		const refClient = new ReferenceClient({ backend, identity: phone });
		const t = await connectWebSocketClient(`ws://127.0.0.1:${port}`);
		await t.send(refClient.buildPairRequest(offer.token));
		await vi.waitFor(() => expect(svc!.getStatus().sas).not.toBeNull());
		expect(svc.confirmPairing(true)).toBe(true);
		await t.close();

		// Decision 8: pairing minted AND persisted the acting grant.
		const stored = new XbpPairedDeviceStore({
			dir,
			secureStorage: okStorage,
		}).load();
		expect(stored?.grantedPermissions).toEqual([...NEW_PAIRING_GRANTS]);

		// Restart from the same dir: startup re-attach replays the stored grant.
		await svc.stop();
		const { port: port2 } = await svc.start();
		const {
			peer,
			hostNode,
			transport: transport2,
		} = await connectPeer(port2!, phone, offer.signPubHex, offer.boxPubHex);
		await expect(
			peer.call(hostNode, pauseSessionCapability, { worktreeId: "wt-1" }),
		).resolves.toMatchObject({ ok: true, state: "paused" });
		expect(calls).toEqual(["pause"]);
		peer.stop();
		await transport2.close();
	});
});
