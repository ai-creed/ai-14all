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
	registerPushTokenCapability,
	deregisterPushTokenCapability,
	listPtysCapability,
	subscribePtyCapability,
	unsubscribePtyCapability,
	ptyRowsCapability,
	SESSION_CHANGED_TOPIC,
	PTY_CHANGED_TOPIC,
	type LifecycleResult,
	type SessionReportResult,
} from "@ai-creed/command-contract";
import { createCoalescer } from "./coalescer.js";
import type { XbpAuditSink } from "./xbp-audit-sink.js";
import type { XbpActingExecutor } from "./xbp-acting-executor.js";
import type { PushTokenHandlers } from "./xbp-push-token-handlers.js";
import type { PtySubscriptionRegistry } from "../pty-inspect/pty-subscription-registry.js";
import type { AgentPtyCatalog } from "../pty-inspect/agent-pty-catalog.js";

// Produced here so Task 8's PtyInspectService can satisfy it structurally —
// this task compiles before that concrete implementation exists.
export type PtyInspectBinding = {
	registry: PtySubscriptionRegistry;
	catalog: AgentPtyCatalog;
	bindHintEmitter(
		emit: (p: {
			worktreeId: string;
			agentId: string;
			epoch: number;
			watermark: number;
		}) => void,
	): void;
	onPeerDetach(): void;
	onRePair(): void;
	// Async by necessity: worktree lookup shells out through
	// WorktreeService.findWorktree() — there is no synchronous worktree-ID
	// index in the main process (WorkspaceRegistryService stores only
	// repositories).
	isKnownWorktree(worktreeId: string): Promise<boolean>;
};

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
			pushToken?: PushTokenHandlers;
			ptyInspect?: PtyInspectBinding;
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
		// One paired phone: replacement is a re-pair, not a transport loss —
		// dropping the previous live peer here must not read as onPeerDetach().
		this.detach("re-pair");

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

		const pushToken = this.opts.pushToken;
		if (pushToken) {
			peer.expose(registerPushTokenCapability, (args) =>
				pushToken.register(args),
			);
			peer.expose(deregisterPushTokenCapability, () => pushToken.deregister());
		}

		if (this.opts.ptyInspect) {
			const ptyInspect = this.opts.ptyInspect;
			const { registry, catalog } = ptyInspect;
			peer.expose(listPtysCapability, async (args: { worktreeId: string }) => {
				// Unknown session → no-such-pty (spec §3). A KNOWN worktree with
				// zero agents legitimately returns an empty list — the async
				// resolver distinguishes the two (worktree lookup shells out, so
				// this handler is async like the lifecycle capabilities).
				if (!(await ptyInspect.isKnownWorktree(args.worktreeId))) {
					return { ok: false, code: "no-such-pty" };
				}
				return { ok: true, ptys: catalog.listPtys(args.worktreeId) };
			});
			peer.expose(
				subscribePtyCapability,
				(args: { worktreeId: string; agentId: string }) =>
					registry.subscribe(args.worktreeId, args.agentId),
			);
			peer.expose(
				unsubscribePtyCapability,
				(args: { worktreeId: string; agentId: string }) =>
					registry.unsubscribe(args.worktreeId, args.agentId),
			);
			peer.expose(
				ptyRowsCapability,
				(args: { worktreeId: string; agentId: string; cursor: string | null }) =>
					registry.pullRows(args.worktreeId, args.agentId, args.cursor ?? null),
			);
		}

		peer.start();
		this.peer = peer;

		// Hints are content-free hop notifications (spec §5): route them to the
		// phone that is live right now, not the one live when bindHintEmitter was
		// called — a subscription can outlive a re-pair mid-flight.
		this.opts.ptyInspect?.bindHintEmitter((payload) => {
			if (this.peer && this.phoneNode) {
				this.peer.emit(this.phoneNode, PTY_CHANGED_TOPIC, payload);
			}
		});
	}

	notifyChanged(): void {
		this.coalescer.trigger();
	}

	detach(cause: "peer-detach" | "re-pair" = "peer-detach"): void {
		// De-authorize the phone but keep serving: the shared transport and the
		// change coalescer stay up so a fresh attach() (re-pair) works immediately.
		// Unlike stop(), this must NOT cancel the coalescer.
		const hadLivePeer = this.peer !== null;
		this.peer?.stop();
		this.peer = null;
		this.phoneNode = null;
		// A first-ever attach() finds no live peer here — nothing was actually
		// torn down, so it must not fire onRePair()/onPeerDetach() for nothing.
		if (hadLivePeer) {
			if (cause === "re-pair") this.opts.ptyInspect?.onRePair();
			else this.opts.ptyInspect?.onPeerDetach();
		}
	}

	stop(): void {
		this.coalescer.cancel();
		this.detach();
	}
}
