// services/xbp/xbp-conformance-harness.ts
//
// ai-14all flavour of the SDK conformance harness.  Mirrors the structure of
// @xavier/xbp's createReferenceHarness but wires in ai-14all's real
// XbpAuditSink (Task 4) and an identity produced by XbpIdentityStore (Task 3)
// to prove the persisted-identity path participates in the conformance gate.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AntiReplay,
	AuditLog,
	CapabilityRegistry,
	createNodeSodiumBackend,
	decodeFrame,
	generateIdentity,
	helloCapability,
	PairAccept,
	ReferenceClient,
	ReferenceHost,
	toHex,
} from "@xavier/xbp/node";
import type {
	ConformanceHarness,
	HarnessFactory,
} from "@xavier/xbp/conformance";
import { XbpAuditSink } from "./xbp-audit-sink.js";
import { XbpIdentityStore, type SecureStorage } from "./xbp-identity-store.js";

// ---------------------------------------------------------------------------
// Fake SecureStorage — encrypt/decrypt via UTF-8 Buffer round-trip, always
// reports encryption as available.  Used only in tests / conformance checks.
// ---------------------------------------------------------------------------
function fakeSecureStorage(): SecureStorage {
	return {
		isEncryptionAvailable: () => true,
		encryptString: (plain: string) => Buffer.from(plain, "utf8"),
		decryptString: (encrypted: Buffer) => encrypted.toString("utf8"),
	};
}

// ---------------------------------------------------------------------------
// createAi14allConformanceHarness
// ---------------------------------------------------------------------------
export async function createAi14allConformanceHarness(opts?: {
	grantedPermissions?: string[];
}): Promise<ConformanceHarness> {
	const backend = await createNodeSodiumBackend();
	const registry = new CapabilityRegistry();
	registry.register(helloCapability);

	// ai-14all audit — real XbpAuditSink writing to a temp dir.
	const auditDir = mkdtempSync(join(tmpdir(), "xbp-conformance-audit-"));
	const audit = new XbpAuditSink({ dir: auditDir });

	// ai-14all identity — produced by XbpIdentityStore (fake SecureStorage).
	const identityDir = mkdtempSync(join(tmpdir(), "xbp-conformance-identity-"));
	const { identity } = new XbpIdentityStore({
		dir: identityDir,
		backend,
		secureStorage: fakeSecureStorage(),
	}).load();

	// Host: cast audit as unknown as AuditLog — sound because ReferenceHost
	// only calls audit.append(...), which XbpAuditSink implements identically.
	// (Same idiom already adjudicated sound in Task 6 / xbp-pairing-host.ts.)
	const host = new ReferenceHost({
		backend,
		identity,
		registry,
		antiReplay: new AntiReplay(),
		audit: audit as unknown as AuditLog,
		handlers: {
			hello: (params) => ({
				youSaid: (params as { greeting: string }).greeting,
			}),
		},
		grantedPermissions: opts?.grantedPermissions,
	});

	// Client uses a fresh ephemeral identity (not the store — only the host
	// identity path is exercised through XbpIdentityStore).
	const client = new ReferenceClient({
		backend,
		identity: generateIdentity(backend),
	});

	const finishPairing = (clientSas: string) => {
		const hostSas = host.lastSas as string;
		const confirmed = hostSas === clientSas;
		host.confirmPairing(confirmed);
		client.confirmPairing(confirmed);
		return { hostSas, clientSas, paired: host.isPaired };
	};

	return {
		backend,
		pair() {
			const offer = host.createPairingOffer();
			const accept = PairAccept.parse(
				decodeFrame(host.handle(client.buildPairRequest(offer.token))!),
			);
			return finishPairing(client.acceptPairResponse(accept, offer));
		},
		pairWithSubstitutedKey() {
			const offer = host.createPairingOffer();
			const accept = PairAccept.parse(
				decodeFrame(host.handle(client.buildPairRequest(offer.token))!),
			);
			const attacker = backend.generateBoxKeyPair();
			return finishPairing(
				client.acceptPairResponse(accept, {
					...offer,
					boxPubHex: toHex(attacker.publicKey),
				}),
			);
		},
		send(cap, params, sendOpts) {
			const before = audit.entries().length;
			const ackBytes = host.handle(client.buildRequest(cap, params, sendOpts));
			const ack = ackBytes ? client.openAck(ackBytes) : null;
			const entries = audit.entries();
			const reason =
				entries.length > before
					? entries[entries.length - 1].reason
					: undefined;
			return { ack, reason };
		},
		sendRawFrame(frame) {
			const before = audit.entries().length;
			const ackBytes = host.handle(frame);
			const ack = ackBytes ? client.openAck(ackBytes) : null;
			const entries = audit.entries();
			const reason =
				entries.length > before
					? entries[entries.length - 1].reason
					: undefined;
			return { ack, reason };
		},
		setKillSwitch(on) {
			host.killSwitch = on;
		},
		auditEntries() {
			return audit.entries();
		},
	};
}

// Re-export as HarnessFactory for callers who want the typed factory shape.
export type { ConformanceHarness, HarnessFactory };
