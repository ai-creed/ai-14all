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
import type {
	PtyRefusal,
	PtySubscriptionRegistry,
} from "../pty-inspect/pty-subscription-registry.js";
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
	// Spec §4: every refusal from any of the four PTY-inspect capabilities
	// lands in the audit, so each capability handler below calls this after a
	// `{ ok: false }` result before returning it.
	auditRefusal(
		capabilityId: string,
		worktreeId: string,
		agentId: string | null,
		code: "no-such-pty" | "no-live-agent" | "internal",
	): void;
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
			// Spec §4: audit every refusal from the three registry-backed
			// capabilities (they all return the same `{ ok: false; code }` shape
			// on refusal). listPtysCapability below checks a precondition by hand
			// instead of wrapping a registry call, so it audits inline.
			const withRefusalAudit =
				<
					A extends { worktreeId: string; agentId: string },
					R extends PtyRefusal | { ok: true },
				>(
					capabilityId: string,
					call: (args: A) => R | Promise<R>,
				) =>
				async (args: A): Promise<R> => {
					const result = await call(args);
					if (!result.ok) {
						ptyInspect.auditRefusal(
							capabilityId,
							args.worktreeId,
							args.agentId,
							result.code,
						);
					}
					return result;
				};
			peer.expose(listPtysCapability, async (args: { worktreeId: string }) => {
				// Unknown session → no-such-pty (spec §3). A KNOWN worktree with
				// zero agents legitimately returns an empty list — the async
				// resolver distinguishes the two (worktree lookup shells out, so
				// this handler is async like the lifecycle capabilities).
				if (!(await ptyInspect.isKnownWorktree(args.worktreeId))) {
					ptyInspect.auditRefusal(
						listPtysCapability.id,
						args.worktreeId,
						null,
						"no-such-pty",
					);
					return { ok: false, code: "no-such-pty" };
				}
				return { ok: true, ptys: catalog.listPtys(args.worktreeId) };
			});
			peer.expose(
				subscribePtyCapability,
				withRefusalAudit(
					subscribePtyCapability.id,
					(args: { worktreeId: string; agentId: string }) =>
						registry.subscribe(args.worktreeId, args.agentId),
				),
			);
			peer.expose(
				unsubscribePtyCapability,
				withRefusalAudit(
					unsubscribePtyCapability.id,
					(args: { worktreeId: string; agentId: string }) =>
						registry.unsubscribe(args.worktreeId, args.agentId),
				),
			);
			peer.expose(
				ptyRowsCapability,
				withRefusalAudit(
					ptyRowsCapability.id,
					(args: {
						worktreeId: string;
						agentId: string;
						cursor: string | null;
					}) =>
						registry.pullRows(args.worktreeId, args.agentId, args.cursor ?? null),
				),
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
