// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createInMemoryPair,
	createNodeSodiumBackend,
	generateIdentity,
	Peer,
} from "@xavier/xbp/node";
import {
	CONTROL_NOTIFY,
	COMMAND_CONTRACT_VERSION,
	RegisterPushTokenArgs,
	RegisterPushTokenResult,
	DeregisterPushTokenResult,
	registerPushTokenCapability,
	deregisterPushTokenCapability,
} from "@ai-creed/command-contract";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPeerSession } from "../../../services/xbp/xbp-peer-session";

describe("push-token contract surface (0.1.0-alpha.6)", () => {
	it("exposes register/deregister under control:notify", () => {
		expect(CONTROL_NOTIFY).toBe("control:notify");
		expect(COMMAND_CONTRACT_VERSION).toBe(8);
		expect(registerPushTokenCapability.id).toBe(
			"xavier.control.register-push-token",
		);
		expect(deregisterPushTokenCapability.id).toBe(
			"xavier.control.deregister-push-token",
		);
		for (const cap of [
			registerPushTokenCapability,
			deregisterPushTokenCapability,
		]) {
			expect(cap.permission).toBe(CONTROL_NOTIFY);
			expect(cap.risk).toBe("low");
		}
	});

	it("validates args and result unions", () => {
		expect(
			RegisterPushTokenArgs.safeParse({
				expoPushToken: "ExponentPushToken[abc]",
				platform: "ios",
			}).success,
		).toBe(true);
		expect(RegisterPushTokenArgs.safeParse({}).success).toBe(false);
		expect(
			RegisterPushTokenResult.safeParse({
				ok: true,
				registeredAt: "2026-07-08T00:00:00.000Z",
			}).success,
		).toBe(true);
		expect(
			RegisterPushTokenResult.safeParse({ ok: false, code: "push-disabled" })
				.success,
		).toBe(true);
		expect(
			DeregisterPushTokenResult.safeParse({
				ok: true,
				deregisteredAt: "2026-07-08T00:00:00.000Z",
			}).success,
		).toBe(true);
	});
});

// push-wake v2 §3 gate 2: an in-process host XbpPeerSession + client Peer over
// a shared in-memory transport, exercising a real capability call through the
// wire so the killGuard stamp (getInboundGeneration -> lastAuthedConnection)
// is proven end-to-end rather than only at the unit level.
//
// Shared by both tests below: build a paired session + connected client Peer,
// stamping via a real registerPushTokenCapability round trip. killSwitchOn lets
// the kill-switch-ordering test reuse the exact same wiring.
async function buildStampHarness(opts: {
	fixedNow: number;
	generation: number;
	killSwitchOn?: boolean;
}) {
	const backend = await createNodeSodiumBackend();
	const [hostT, clientT] = createInMemoryPair();
	const audit = new XbpAuditSink({
		dir: mkdtempSync(join(tmpdir(), "xbp-push-stamp-")),
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
		pushToken: {
			register: async () => ({
				ok: true,
				registeredAt: new Date(opts.fixedNow).toISOString(),
			}),
			deregister: async () => ({
				ok: true,
				deregisteredAt: new Date(opts.fixedNow).toISOString(),
			}),
		},
		now: () => opts.fixedNow,
		getInboundGeneration: () => opts.generation,
	});
	if (opts.killSwitchOn) session.setKillSwitch(true);
	session.attach(clientIdentity.sign.publicKey, clientIdentity.box.publicKey, [
		CONTROL_NOTIFY,
	]);

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

	return { session, client, hostNode };
}

describe("push-wake v2: generation-bound authenticated-connection stamp", () => {
	it("stamps getLastAuthedConnection() on a successful register-push-token call, clears it on detach", async () => {
		const FIXED_NOW = 1_700_000_000_000;
		const { session, client, hostNode } = await buildStampHarness({
			fixedNow: FIXED_NOW,
			generation: 42,
		});

		await expect(
			client.call(hostNode, registerPushTokenCapability, {
				expoPushToken: "ExponentPushToken[stamp-test]",
				platform: "ios",
			}),
		).resolves.toMatchObject({ ok: true });

		expect(session.getLastAuthedConnection()).toEqual({
			generation: 42,
			at: FIXED_NOW,
		});

		session.detach();
		expect(session.getLastAuthedConnection()).toBeNull();

		session.stop();
	});

	it("stamps getLastAuthedConnection() even when the kill switch rejects the call (kill switch halts capability execution, never connectivity)", async () => {
		const FIXED_NOW = 1_700_000_000_000;
		const { session, client, hostNode } = await buildStampHarness({
			fixedNow: FIXED_NOW,
			generation: 42,
			killSwitchOn: true,
		});

		await expect(
			client.call(hostNode, registerPushTokenCapability, {
				expoPushToken: "ExponentPushToken[kill-switch-test]",
				platform: "ios",
			}),
		).rejects.toThrow();

		// The killGuard stamps BEFORE checking this.killed: a killed request
		// still proves the phone is live on this socket, so the stamp must
		// survive the rejection untouched.
		expect(session.getLastAuthedConnection()).toEqual({
			generation: 42,
			at: FIXED_NOW,
		});

		session.stop();
	});
});
