// tests/integration/xbp/host-service-forget.test.ts
// Spec: docs/superpowers/specs/2026-07-09-phone-bridge-unpair-forget-design.md
// Acceptance B (re-pair after forget), C (live phone severed), F (mid-SAS
// forget cancels the pending pairing).
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	connectWebSocketClient,
	createNodeSodiumBackend,
	generateIdentity,
	ReferenceClient,
	toHex,
} from "@xavier/xbp/node";
import { sessionReportCapability } from "@ai-creed/command-contract";
import { XbpHostService } from "../../../services/xbp/xbp-host-service";
import { XbpPairedDeviceStore } from "../../../services/xbp/xbp-paired-device-store";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { connectPeer, okStorage, pairPhone } from "./pairing-helpers";

function makeService(dir: string) {
	return new XbpHostService({
		dir,
		secureStorage: okStorage,
		getSessionReport: async () => ({
			mode: "ready",
			focus: null,
			sessions: [],
		}),
		subscribeChanges: () => () => {},
	});
}

let svc: XbpHostService | undefined;
afterEach(async () => {
	await svc?.stop();
	svc = undefined;
});

describe("XbpHostService.forgetDevice (live transport)", () => {
	it("mid-SAS forget cancels the pending pairing: stale Confirm pairs nothing, old offer token is dead", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-forget-sas-"));
		const phone = generateIdentity(backend);
		svc = makeService(dir);
		const { port } = await svc.start();

		// Drive a REAL pending pairing: offer -> pair-request -> SAS displayed.
		const offer = await svc.startPairing();
		const refClient = new ReferenceClient({ backend, identity: phone });
		const t = await connectWebSocketClient(`ws://127.0.0.1:${port}`);
		await t.send(refClient.buildPairRequest(offer.token));
		await vi.waitFor(() => expect(svc!.getStatus().sas).not.toBeNull());

		await svc.forgetDevice();

		// SAS gone, forget audited exactly once with zero rejected noise.
		expect(svc.getStatus().sas).toBeNull();
		const entries = new XbpAuditSink({ dir }).entries();
		expect(
			entries.filter(
				(e) => e.outcome === "accepted" && e.reason === "device-forgotten",
			),
		).toHaveLength(1);
		expect(entries.filter((e) => e.outcome === "rejected")).toHaveLength(0);

		// A stale Confirm after the forget must pair nothing.
		expect(svc.confirmPairing(true)).toBe(false);
		expect(svc.getStatus().paired).toBe(false);
		expect(
			new XbpPairedDeviceStore({ dir, secureStorage: okStorage }).load(),
		).toBeNull();

		// Replaying the pre-forget offer token mints no new SAS.
		await t.send(refClient.buildPairRequest(offer.token));
		await new Promise((r) => setTimeout(r, 100));
		expect(svc.getStatus().sas).toBeNull();
		await t.close();
	});

	it("re-pair works after forget: a fresh pairing completes end-to-end on the same service instance", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-forget-repair-"));
		svc = makeService(dir);
		const { port } = await svc.start();
		const phoneA = generateIdentity(backend);
		const phoneB = generateIdentity(backend);

		await pairPhone(svc, port!, phoneA);
		expect(svc.getStatus().paired).toBe(true);

		await svc.forgetDevice();
		expect(svc.getStatus().paired).toBe(false);

		await pairPhone(svc, port!, phoneB);
		expect(svc.getStatus().paired).toBe(true);
		expect(
			new XbpPairedDeviceStore({ dir, secureStorage: okStorage }).load()
				?.signPubHex,
		).toBe(toHex(phoneB.sign.publicKey));
	});

	it("a live connected phone is severed by forget: its next call fails", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-forget-sever-"));
		const phone = generateIdentity(backend);
		svc = makeService(dir);
		const { port } = await svc.start();
		const offer = await pairPhone(svc, port!, phone);

		const { peer, hostNode, transport } = await connectPeer(
			port!,
			phone,
			offer.signPubHex,
			offer.boxPubHex,
			{ requestTimeoutMs: 500 },
		);
		await expect(
			peer.call(hostNode, sessionReportCapability, {}),
		).resolves.toMatchObject({ mode: "ready" });

		await svc.forgetDevice();

		await expect(
			peer.call(hostNode, sessionReportCapability, {}),
		).rejects.toThrow();
		peer.stop();
		await transport.close();
	});
});
