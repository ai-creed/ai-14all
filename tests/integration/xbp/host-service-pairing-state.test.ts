// tests/integration/xbp/host-service-pairing-state.test.ts
// Spec: docs/superpowers/specs/2026-07-15-phone-bridge-dialog-redesign-design.md §3, §8
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	connectWebSocketClient,
	createNodeSodiumBackend,
	generateIdentity,
	ReferenceClient,
} from "@xavier/xbp/node";
import { XbpHostService } from "../../../services/xbp/xbp-host-service";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPairedDeviceStore } from "../../../services/xbp/xbp-paired-device-store";
import { okStorage, pairPhone } from "./pairing-helpers";

function makeService(
	dir: string,
	opts?: { now?: () => number; onStatusChange?: () => void },
) {
	return new XbpHostService({
		dir,
		secureStorage: okStorage,
		getSessionReport: async () => ({
			mode: "ready",
			focus: null,
			sessions: [],
		}),
		subscribeChanges: () => () => {},
		now: opts?.now,
		onStatusChange: opts?.onStatusChange,
	});
}

let svc: XbpHostService | undefined;
afterEach(async () => {
	vi.useRealTimers();
	await svc?.stop();
	svc = undefined;
});

describe("XbpHostService pairing state machine", () => {
	it("startPairing tracks a pending offer: pairing=awaiting-scan with payload + expiry", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		svc = makeService(dir);
		await svc.start();
		const offer = await svc.startPairing();
		const s = svc.getStatus();
		expect(s.pairing).toBe("awaiting-scan");
		expect(s.offer).toBe(JSON.stringify(offer));
		expect(s.offerExpiresAt).toBe(offer.expiresAt);
		expect(s.sas).toBeNull();
	});

	it("accepted confirm clears SAS and offer: paired:true, sas:null, pairing:idle (regression)", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		const phone = generateIdentity(backend);
		svc = makeService(dir);
		const { port } = await svc.start();
		await pairPhone(svc, port, phone); // startPairing → pair-request → confirmPairing(true)
		const s = svc.getStatus();
		expect(s.paired).toBe(true);
		// Fails against an implementation that clears pendingOffer but skips
		// the fresh-host swap on accept — the vendor host never clears lastSas.
		expect(s.sas).toBeNull();
		expect(s.pairing).toBe("idle");
		expect(s.offer).toBeNull();
		expect(s.pairedAt).toBeGreaterThan(0);
		expect(s.grantedPermissions).toContain("control:act");
	});

	it("rejected confirm clears SAS and offer and returns to idle (stuck-SAS regression)", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		const phone = generateIdentity(backend);
		svc = makeService(dir);
		const { port } = await svc.start();
		const offer = await svc.startPairing();
		const refClient = new ReferenceClient({ backend, identity: phone });
		const t = await connectWebSocketClient(`ws://127.0.0.1:${port}`);
		try {
			await t.send(refClient.buildPairRequest(offer.token));
			await vi.waitFor(() => expect(svc!.getStatus().sas).not.toBeNull());
			expect(svc.confirmPairing(false)).toBe(false);
			const s = svc.getStatus();
			expect(s.sas).toBeNull();
			expect(s.pairing).toBe("idle");
			expect(s.offer).toBeNull();
			expect(s.paired).toBe(false);
			// A stale Confirm after the reject pairs nothing.
			expect(svc.confirmPairing(true)).toBe(false);
			expect(svc.getStatus().paired).toBe(false);
		} finally {
			await t.close();
		}
	});

	it("cancelPairing kills the pending offer fail-closed and audits exactly once", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		const phone = generateIdentity(backend);
		svc = makeService(dir);
		const { port } = await svc.start();
		const offer = await svc.startPairing();
		await svc.cancelPairing();
		const s = svc.getStatus();
		expect(s.pairing).toBe("idle");
		expect(s.offer).toBeNull();
		// Stale Confirm attaches nothing.
		expect(svc.confirmPairing(true)).toBe(false);
		// Replaying the dead offer token mints no SAS and persists nothing.
		const refClient = new ReferenceClient({ backend, identity: phone });
		const t = await connectWebSocketClient(`ws://127.0.0.1:${port}`);
		try {
			await t.send(refClient.buildPairRequest(offer.token));
			await new Promise((r) => setTimeout(r, 100));
			expect(svc.getStatus().sas).toBeNull();
			expect(
				new XbpPairedDeviceStore({ dir, secureStorage: okStorage }).load(),
			).toBeNull();
			const cancelled = new XbpAuditSink({ dir })
				.entries()
				.filter(
					(e) => e.outcome === "accepted" && e.reason === "pairing-cancelled",
				);
			expect(cancelled).toHaveLength(1);
		} finally {
			await t.close();
		}
	});

	it("forgetDevice clears a pending offer (scan → forget → idle)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		svc = makeService(dir);
		await svc.start();
		await svc.startPairing();
		expect(svc.getStatus().pairing).toBe("awaiting-scan");
		await svc.forgetDevice();
		const s = svc.getStatus();
		expect(s.pairing).toBe("idle");
		expect(s.offer).toBeNull();
		expect(s.offerExpiresAt).toBeNull();
	});

	it("stop clears a pending offer; a restart comes back idle with no offer", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		svc = makeService(dir);
		await svc.start();
		await svc.startPairing();
		await svc.stop();
		let s = svc.getStatus();
		expect(s.enabled).toBe(false);
		expect(s.pairing).toBe("idle");
		expect(s.offer).toBeNull();
		expect(s.offerExpiresAt).toBeNull();
		await svc.start();
		s = svc.getStatus();
		expect(s.pairing).toBe("idle");
		expect(s.offer).toBeNull();
	});

	it("an expired offer is lazily treated as absent by getStatus", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		let clock = 1_000_000_000;
		svc = makeService(dir, { now: () => clock });
		await svc.start();
		await svc.startPairing();
		expect(svc.getStatus().pairing).toBe("awaiting-scan");
		clock += 180_001; // past the vendor's 180s offer TTL
		const s = svc.getStatus();
		expect(s.pairing).toBe("idle");
		expect(s.offer).toBeNull();
		expect(s.offerExpiresAt).toBeNull();
	});

	it("offer expiry emits a status change without polling", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		const onStatusChange = vi.fn();
		svc = makeService(dir, { onStatusChange });
		await svc.start();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		await svc.startPairing();
		onStatusChange.mockClear();
		vi.advanceTimersByTime(180_001);
		expect(onStatusChange).toHaveBeenCalledTimes(1);
		expect(svc.getStatus().pairing).toBe("idle");
		vi.useRealTimers();
	});

	it("a failing operation records lastError; the next successful one clears it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		svc = makeService(dir);
		// startPairing before start(): pairingHost is null → throws and records.
		await expect(svc.startPairing()).rejects.toThrow();
		expect(svc.getStatus().lastError).not.toBeNull();
		await svc.setEnabled(true);
		expect(svc.getStatus().lastError).toBeNull();
	});

	it("a start() failure (safe storage unavailable) records lastError", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		// Fail-closed path: the identity store throws when encryption is off.
		const badStorage = {
			isEncryptionAvailable: () => false,
			encryptString: (s: string) => Buffer.from(s, "utf8"),
			decryptString: (b: Buffer) => b.toString("utf8"),
		};
		const failing = new XbpHostService({
			dir,
			secureStorage: badStorage,
			getSessionReport: async () => ({
				mode: "ready",
				focus: null,
				sessions: [],
			}),
			subscribeChanges: () => () => {},
		});
		await expect(failing.start()).rejects.toThrow();
		expect(failing.getStatus().lastError).not.toBeNull();
	});

	it("a failed enable leaves user intent visible: enabled:true, listening:false (fault state)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-state-"));
		// Fail-closed path: the identity store throws when encryption is off.
		const badStorage = {
			isEncryptionAvailable: () => false,
			encryptString: (s: string) => Buffer.from(s, "utf8"),
			decryptString: (b: Buffer) => b.toString("utf8"),
		};
		svc = new XbpHostService({
			dir,
			secureStorage: badStorage,
			getSessionReport: async () => ({
				mode: "ready",
				focus: null,
				sessions: [],
			}),
			subscribeChanges: () => () => {},
		});
		await expect(svc.setEnabled(true)).rejects.toThrow();
		const s = svc.getStatus();
		expect(s.enabled).toBe(true);
		expect(s.listening).toBe(false);
		expect(s.lastError).not.toBeNull();
	});
});
