// services/xbp/xbp-peer-session.ts
import {
	Peer,
	type Identity,
	type SodiumBackend,
	type Transport,
} from "@xavier/xbp/node";
import {
	sessionReportCapability,
	SESSION_CHANGED_TOPIC,
	type SessionReportResult,
} from "@ai-creed/command-contract";
import { createCoalescer } from "./coalescer.js";
import type { XbpAuditSink } from "./xbp-audit-sink.js";

export class XbpPeerSession {
	private peer: Peer | null = null;
	private phoneNode: string | null = null;
	private readonly coalescer: { trigger(): void; cancel(): void };

	constructor(
		private readonly opts: {
			backend: SodiumBackend;
			identity: Identity;
			transport: Transport;
			audit: XbpAuditSink;
			getSessionReport: () => Promise<SessionReportResult>;
			coalesceMs?: number;
			now?: () => number;
		},
	) {
		const now = opts.now ?? Date.now;
		this.coalescer = createCoalescer(() => {
			if (this.peer && this.phoneNode) {
				this.peer.emit(this.phoneNode, SESSION_CHANGED_TOPIC, {
					changedAt: now(),
				});
			}
		}, opts.coalesceMs ?? 250);
	}

	attach(
		phoneSignPub: Uint8Array,
		phoneBoxPub: Uint8Array,
		grantedPermissions: string[] = [sessionReportCapability.permission],
	): void {
		const peer = new Peer({
			backend: this.opts.backend,
			identity: this.opts.identity,
			transport: this.opts.transport,
			audit: this.opts.audit,
		});
		this.phoneNode = peer.addPeer(
			phoneSignPub,
			phoneBoxPub,
			grantedPermissions,
		);
		peer.expose(sessionReportCapability, () => this.opts.getSessionReport());
		peer.start();
		this.peer = peer;
	}

	notifyChanged(): void {
		this.coalescer.trigger();
	}

	stop(): void {
		this.coalescer.cancel();
		this.peer?.stop();
		this.peer = null;
		this.phoneNode = null;
	}
}
