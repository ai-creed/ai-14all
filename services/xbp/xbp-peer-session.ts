// services/xbp/xbp-peer-session.ts
import {
	Peer,
	type Identity,
	type SodiumBackend,
	type Transport,
} from "@xavier/xbp/node";
import {
	pauseSessionCapability,
	resumeSessionCapability,
	stopSessionCapability,
	sessionReportCapability,
	SESSION_CHANGED_TOPIC,
	type LifecycleResult,
	type SessionReportResult,
} from "@ai-creed/command-contract";
import { createCoalescer } from "./coalescer.js";
import type { XbpAuditSink } from "./xbp-audit-sink.js";
import type { XbpActingExecutor } from "./xbp-acting-executor.js";

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
			acting?: XbpActingExecutor;
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
		// One paired phone: re-pairing must drop the previous live peer so the old
		// phone's Peer is no longer subscribed/authorized on the transport.
		this.peer?.stop();
		this.peer = null;
		this.phoneNode = null;

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

		const acting = this.opts.acting;
		if (acting) {
			const wrap =
				(call: (worktreeId: string) => Promise<LifecycleResult>) =>
				async (args: { worktreeId: string }) => {
					const result = await call(args.worktreeId);
					// AC4: success reflects in Observe via the same coalesced
					// session-changed the report path uses; refusals fire no event.
					if (result.ok) this.notifyChanged();
					return result;
				};
			peer.expose(
				pauseSessionCapability,
				wrap((w) => acting.pause(w)),
			);
			peer.expose(
				resumeSessionCapability,
				wrap((w) => acting.resume(w)),
			);
			peer.expose(
				stopSessionCapability,
				wrap((w) => acting.stop(w)),
			);
		}

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
