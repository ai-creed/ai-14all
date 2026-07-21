import {
	subscribePtyCapability,
	unsubscribePtyCapability,
} from "@ai-creed/command-contract";
import type { TerminalService } from "../terminals/terminal-service.js";
import { InspectAuditLogger } from "../diagnostics/inspect-audit-logger.js";
import { AgentPtyCatalog } from "./agent-pty-catalog.js";
import { PtySubscriptionRegistry } from "./pty-subscription-registry.js";

type HintPayload = {
	worktreeId: string;
	agentId: string;
	epoch: number;
	watermark: number;
};

const CAPABILITY_BY_OP: Record<string, string | null> = {
	subscribe: subscribePtyCapability.id,
	replace: subscribePtyCapability.id, // replacement originates from subscribe-pty
	unsubscribe: unsubscribePtyCapability.id,
	teardown: null,
};

// Composition seam (spec §§1.2/3-4 wiring): constructed BEFORE the XBP host
// starts (electron/main/index.ts builds the host at ~:542 while
// TerminalService only exists inside registerIpcHandlers at ~:739), injected
// into XbpPeerSession at construction, attached to the TerminalService later.
// Structurally satisfies Task 7's PtyInspectBinding (+ auditRefusal, which
// that type also declares).
export class PtyInspectService {
	readonly catalog = new AgentPtyCatalog();
	readonly audit: InspectAuditLogger;
	readonly registry: PtySubscriptionRegistry;
	private hintEmitter: ((p: HintPayload) => void) | null = null;

	private readonly resolveWorktree: (
		worktreeId: string,
	) => Promise<{ workspaceId: string; cwd: string } | null>;

	constructor(opts: {
		logsDir: string;
		// The composition root passes the existing async resolveWorktreeRef
		// (electron/main/index.ts:411-426) — worktree lookup shells out through
		// WorktreeService.findWorktree(), so there is no sync alternative.
		resolveWorktree: (
			worktreeId: string,
		) => Promise<{ workspaceId: string; cwd: string } | null>;
	}) {
		this.resolveWorktree = opts.resolveWorktree;
		this.audit = new InspectAuditLogger({ logsDir: opts.logsDir });
		this.registry = new PtySubscriptionRegistry({
			catalog: this.catalog,
			emitHint: (p) => this.hintEmitter?.(p),
		});
		// Spec §4: lifecycle entries carry the ORIGINATING capability id;
		// `null` is reserved for auto-teardown.
		this.registry.onLifecycle((ev) =>
			this.audit.append({
				ts: Date.now(),
				op: ev.op,
				cause: (ev.cause as never) ?? null,
				capability: CAPABILITY_BY_OP[ev.op] ?? null,
				worktreeId: ev.worktreeId,
				agentId: ev.agentId,
				refusalCode: null,
				rowsServed: ev.rowsServed,
			}),
		);
	}

	async isKnownWorktree(worktreeId: string): Promise<boolean> {
		return (await this.resolveWorktree(worktreeId)) !== null;
	}

	bindHintEmitter(emit: (p: HintPayload) => void): void {
		this.hintEmitter = emit;
	}

	onPeerDetach(): void {
		this.hintEmitter = null;
		this.registry.teardown("peer-detach");
	}

	onRePair(): void {
		this.registry.teardown("re-pair");
	}

	// Refusal audit (spec §4): every refusal from any of the five PTY-inspect
	// capabilities lands in the audit, regardless of which handler produced it.
	// Kept as a thin wrapper here (not baked into the registry) so the registry
	// stays audit-agnostic and listPtysCapability's structural (not lifecycle)
	// refusals — which never flow through PtySubscriptionRegistry — can audit
	// through the same path.
	auditRefusal(
		capabilityId: string,
		worktreeId: string,
		agentId: string | null,
		code: "no-such-pty" | "no-live-agent" | "internal",
	): void {
		this.audit.append({
			ts: Date.now(),
			op: "refusal",
			cause: null,
			capability: capabilityId,
			worktreeId,
			agentId,
			refusalCode: code,
			rowsServed: null,
		});
	}

	attachTerminalService(ts: TerminalService): void {
		this.catalog.attachMirrorSource({
			getMirror: (id) => ts.getMirror(id),
			takeMirror: (id) => ts.takeMirror(id),
		});
		// Resize-on-watch (child spec §2): the registry drives the real PTY resize
		// through the terminal service. Late-attached — TerminalService is
		// constructed after the XBP host, same seam as the mirror source.
		this.registry.attachViewportHost({
			applyWatchResize: (id, cols, rows) => ts.applyWatchResize(id, cols, rows),
			restoreDesktopGeometry: (id) => ts.restoreDesktopGeometry(id),
			getDesktopGeometry: (id) => ts.getDesktopGeometry(id),
			setPhoneOwned: (id, owned) => ts.setPhoneOwned(id, owned),
		});
	}
}
