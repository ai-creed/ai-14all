// services/xbp/xbp-pairing-host.ts
import {
	AntiReplay,
	AuditLog,
	CapabilityRegistry,
	ReferenceHost,
	type Identity,
	type PairingOffer,
	type SodiumBackend,
} from "@xavier/xbp/node";
import type { XbpAuditSink } from "./xbp-audit-sink.js";

const DEFAULT_TTL_MS = 180_000;

export class XbpPairingHost {
	private readonly host: ReferenceHost;
	constructor(opts: {
		backend: SodiumBackend;
		identity: Identity;
		audit: XbpAuditSink;
		pairingTokenTtlMs?: number;
		now?: () => number;
	}) {
		this.host = new ReferenceHost({
			backend: opts.backend,
			identity: opts.identity,
			registry: new CapabilityRegistry(), // live capability rides the Peer (Task 8)
			antiReplay: new AntiReplay(),
			audit: opts.audit as unknown as AuditLog,
			handlers: {},
			grantedPermissions: [],
			pairingTokenTtlMs: opts.pairingTokenTtlMs ?? DEFAULT_TTL_MS,
			now: opts.now,
		});
	}
	createOffer(connect: { url: string }): PairingOffer {
		return this.host.createPairingOffer(connect);
	}
	handle(frame: Uint8Array): Uint8Array | null {
		return this.host.handle(frame);
	}
	confirmPairing(ok: boolean): boolean {
		return this.host.confirmPairing(ok);
	}
	activePeer() {
		return this.host.activePeer();
	}
	get isPaired() {
		return this.host.isPaired;
	}
	get lastSas() {
		return this.host.lastSas;
	}
	set killSwitch(on: boolean) {
		this.host.killSwitch = on;
	}
}
