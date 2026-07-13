import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createNodeSodiumBackend,
	generateIdentity,
	toHex,
} from "@xavier/xbp/node";
import {
	CONTROL_ACT,
	CONTROL_NOTIFY,
	registerPushTokenCapability,
	sessionReportCapability,
} from "@ai-creed/command-contract";
import { XbpHostService } from "../../../services/xbp/xbp-host-service";
import { XbpPairedDeviceStore } from "../../../services/xbp/xbp-paired-device-store";
import { XbpPushTokenStore } from "../../../services/xbp/xbp-push-token-store";
import { createPushTokenHandlers } from "../../../services/xbp/xbp-push-token-handlers";
import { NEW_PAIRING_GRANTS } from "../../../services/xbp/xbp-grants";
import { connectPeer, okStorage, pairPhone } from "./pairing-helpers";

const validArgs = {
	expoPushToken: "ExponentPushToken[integration]",
	platform: "ios" as const,
};

// registerCalls doubles as the semantic-reach probe: if the control:notify
// gate holds, a denied peer must leave it at 0 (handler never invoked).
function makeService(dir: string) {
	const pushTokenStore = new XbpPushTokenStore({
		dir,
		secureStorage: okStorage,
	});
	let registerCalls = 0;
	const inner = createPushTokenHandlers({
		isPushWakeEnabled: () => true,
		store: pushTokenStore,
	});
	const svc = new XbpHostService({
		dir,
		secureStorage: okStorage,
		getSessionReport: async () => ({
			mode: "ready",
			focus: null,
			sessions: [],
		}),
		subscribeChanges: () => () => {},
		pushTokenStore,
		pushTokenHandlers: {
			register: (args) => (registerCalls++, inner.register(args)),
			deregister: () => inner.deregister(),
		},
	});
	return { svc, pushTokenStore, calls: () => registerCalls };
}

let svc: XbpHostService | undefined;
afterEach(async () => {
	await svc?.stop();
	svc = undefined;
});

describe("push-token authorization (control:notify)", () => {
	it("denies a stored device WITHOUT control:notify at the Peer — handler never invoked, slot untouched", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-pta-"));
		const phone = generateIdentity(backend);
		// A v2-era record: acting yes, notify no. No silent upgrade allowed.
		new XbpPairedDeviceStore({ dir, secureStorage: okStorage }).save({
			signPubHex: toHex(phone.sign.publicKey),
			boxPubHex: toHex(phone.box.publicKey),
			pairedAt: 1,
			grantedPermissions: [sessionReportCapability.permission, CONTROL_ACT],
		});
		const made = makeService(dir);
		svc = made.svc;
		const { port } = await svc.start();
		const offer = await svc.startPairing(); // only to learn host public keys
		const { peer, hostNode, transport } = await connectPeer(
			port!,
			phone,
			offer.signPubHex,
			offer.boxPubHex,
		);
		await expect(
			peer.call(hostNode, registerPushTokenCapability, validArgs),
		).rejects.toThrow(); // permission-denied at the Peer, pre-handler
		expect(made.calls()).toBe(0);
		expect(made.pushTokenStore.load()).toBeNull();
		peer.stop();
		await transport.close();
	});

	it("fresh pairing mints control:notify; register works; replayed grant still authorizes after restart", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-ptb-"));
		const phone = generateIdentity(backend);
		const made = makeService(dir);
		svc = made.svc;
		const { port } = await svc.start();
		const offer = await pairPhone(svc, port!, phone);

		expect(
			new XbpPairedDeviceStore({ dir, secureStorage: okStorage }).load()
				?.grantedPermissions,
		).toEqual([...NEW_PAIRING_GRANTS]);
		expect(NEW_PAIRING_GRANTS).toContain(CONTROL_NOTIFY);

		const first = await connectPeer(
			port!,
			phone,
			offer.signPubHex,
			offer.boxPubHex,
		);
		await expect(
			first.peer.call(first.hostNode, registerPushTokenCapability, validArgs),
		).resolves.toMatchObject({ ok: true });
		expect(made.pushTokenStore.load()?.expoPushToken).toBe(
			validArgs.expoPushToken,
		);
		first.peer.stop();
		await first.transport.close();

		// Restart: grantsForStoredDevice replays control:notify.
		await svc.stop();
		const { port: port2 } = await svc.start();
		const second = await connectPeer(
			port2!,
			phone,
			offer.signPubHex,
			offer.boxPubHex,
		);
		await expect(
			second.peer.call(second.hostNode, registerPushTokenCapability, validArgs),
		).resolves.toMatchObject({ ok: true });
		second.peer.stop();
		await second.transport.close();
	});

	it("pairing a replacement device clears the previous token slot", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-ptc-"));
		const made = makeService(dir);
		svc = made.svc;
		const { port } = await svc.start();
		const phoneA = generateIdentity(backend);
		const offer = await pairPhone(svc, port!, phoneA);
		const a = await connectPeer(
			port!,
			phoneA,
			offer.signPubHex,
			offer.boxPubHex,
		);
		await a.peer.call(a.hostNode, registerPushTokenCapability, validArgs);
		a.peer.stop();
		await a.transport.close();
		expect(made.pushTokenStore.exists()).toBe(true);

		const phoneB = generateIdentity(backend);
		await pairPhone(svc, port!, phoneB);
		// Replacement pairing must not inherit phoneA's registration.
		expect(made.pushTokenStore.exists()).toBe(false);
	});

	it("start() with no paired device on disk clears a leftover token (device-forget path)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-ptd-"));
		const made = makeService(dir);
		made.pushTokenStore.save({
			expoPushToken: "ExponentPushToken[stale]",
			platform: "ios",
			registeredAt: 1,
		});
		svc = made.svc;
		await svc.start(); // no paired-device.enc in dir
		expect(made.pushTokenStore.exists()).toBe(false);
	});
});
