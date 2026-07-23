// tests/integration/xbp/kill-switch.test.ts
//
// Kill-switch control path (child spec §5): while killed, EVERY exposed
// capability handler is gated before it runs — the vendor Peer turns the
// guard's throw into an AckError("handler-error") for the phone, and the
// guard's own audit entry (`reason: "kill-switch"`) is the durable,
// assertable contract (a second, vendor-authored `handler-error` entry also
// lands per call — deliberate, not asserted on here). Connectivity itself
// (LAN listener, pairing host, relay registration) is untouched by the flag.
//
// This test constructs the service with every optional handler group enabled
// (acting, push-token, pty-inspect) so the "every capability" contract is
// actually exercised — a newly-added, unwrapped expose() call site would show
// up here as a call that resolves instead of rejecting.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeSodiumBackend, generateIdentity } from "@xavier/xbp/node";
import type { CapabilityDescriptor } from "@ai-creed/command-contract";
import {
	sessionReportCapability,
	pauseSessionCapability,
	resumeSessionCapability,
	stopSessionCapability,
	registerPushTokenCapability,
	deregisterPushTokenCapability,
	listPtysCapability,
	subscribePtyCapability,
	unsubscribePtyCapability,
	ptyRowsCapability,
	setWatchViewportCapability,
} from "@ai-creed/command-contract";
import { XbpHostService } from "../../../services/xbp/xbp-host-service";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPushTokenStore } from "../../../services/xbp/xbp-push-token-store";
import { createPushTokenHandlers } from "../../../services/xbp/xbp-push-token-handlers";
import { PtyInspectService } from "../../../services/pty-inspect/pty-inspect-service";
import type { XbpActingExecutor } from "../../../services/xbp/xbp-acting-executor";
import { connectPeer, okStorage, pairPhone } from "./pairing-helpers";

// Minimal in-memory acting fake: every op reports success without touching a
// real whisper workflow — the kill guard sits in front of it, so it is never
// invoked once svc.setKillSwitch(true) is in effect.
function makeActingFake(): XbpActingExecutor {
	const ok = (worktreeId: string) => ({
		ok: true as const,
		worktreeId,
		workflowId: "wf-1",
		state: "running" as const,
		appliedAt: new Date(0).toISOString(),
	});
	return {
		pause: async (worktreeId) => ok(worktreeId),
		resume: async (worktreeId) => ok(worktreeId),
		stop: async (worktreeId) => ok(worktreeId),
	};
}

function makeService(dir: string) {
	const pushTokenStore = new XbpPushTokenStore({ dir, secureStorage: okStorage });
	const pushTokenHandlers = createPushTokenHandlers({
		isPushWakeEnabled: () => true,
		store: pushTokenStore,
	});
	// PtyInspectService structurally satisfies xbp-peer-session.ts's
	// PtyInspectBinding (see its own header comment) — real registry/catalog,
	// no terminal service attached since these handlers never run past the
	// kill guard in this test.
	const ptyInspect = new PtyInspectService({
		logsDir: mkdtempSync(join(tmpdir(), "xbp-ks-inspect-")),
		resolveWorktree: async () => null,
	});
	const svc = new XbpHostService({
		dir,
		secureStorage: okStorage,
		getSessionReport: async () => ({
			mode: "ready",
			focus: null,
			sessions: [],
		}),
		subscribeChanges: () => () => {},
		acting: makeActingFake(),
		pushTokenStore,
		pushTokenHandlers,
		ptyInspect,
	});
	return svc;
}

// One row per capability exposed by XbpPeerSession.attach() with all optional
// groups enabled (11 total) — a capability missing here is a review-visible
// gap in kill-switch coverage. Args are minimal but schema-valid: an
// args-shape failure rejects at "schema-invalid" (Peer.call validates
// locally) before ever reaching the kill guard.
const ALL_CAPABILITY_CALLS: Array<{
	cap: CapabilityDescriptor<unknown, unknown>;
	args: unknown;
}> = [
	{ cap: sessionReportCapability, args: {} },
	{ cap: pauseSessionCapability, args: { worktreeId: "wt-x" } },
	{ cap: resumeSessionCapability, args: { worktreeId: "wt-x" } },
	{ cap: stopSessionCapability, args: { worktreeId: "wt-x" } },
	{
		cap: registerPushTokenCapability,
		args: { expoPushToken: "ExponentPushToken[ks]", platform: "ios" },
	},
	{ cap: deregisterPushTokenCapability, args: {} },
	{ cap: listPtysCapability, args: { worktreeId: "wt-x" } },
	{ cap: subscribePtyCapability, args: { worktreeId: "wt-x", agentId: "a1" } },
	{
		cap: unsubscribePtyCapability,
		args: { worktreeId: "wt-x", agentId: "a1" },
	},
	{
		cap: ptyRowsCapability,
		args: { worktreeId: "wt-x", agentId: "a1", cursor: null },
	},
	{
		cap: setWatchViewportCapability,
		args: { worktreeId: "wt-x", agentId: "a1", cols: 80, rows: 24 },
	},
];

let svc: XbpHostService | undefined;
afterEach(async () => {
	await svc?.stop();
	svc = undefined;
});

describe("XBP kill-switch control path", () => {
	it("blocks every exposed capability while killed, without touching connectivity", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-ks-"));
		svc = makeService(dir);
		const { port } = await svc.start();
		const backend = await createNodeSodiumBackend();
		const phone = generateIdentity(backend);
		const offer = await pairPhone(svc, port!, phone);
		const { peer, hostNode, transport } = await connectPeer(
			port!,
			phone,
			offer.signPubHex,
			offer.boxPubHex,
		);

		// Baseline: session-report succeeds before the kill switch is engaged.
		await expect(
			peer.call(hostNode, sessionReportCapability, {}),
		).resolves.toMatchObject({ mode: "ready" });

		svc.setKillSwitch(true);
		expect(svc.getStatus().listening).toBe(true);

		for (const { cap, args } of ALL_CAPABILITY_CALLS) {
			await expect(peer.call(hostNode, cap, args)).rejects.toThrow(); // AckError("handler-error")
			const entries = new XbpAuditSink({ dir }).entries();
			expect(
				entries.some(
					(e) =>
						e.cap === cap.id &&
						e.outcome === "rejected" &&
						e.reason === "kill-switch",
				),
			).toBe(true);
		}

		// The LAN listener stays up throughout the kill.
		expect(svc.getStatus().listening).toBe(true);

		// Un-kill: spot-check session-report succeeds again.
		svc.setKillSwitch(false);
		await expect(
			peer.call(hostNode, sessionReportCapability, {}),
		).resolves.toMatchObject({ mode: "ready" });

		peer.stop();
		await transport.close();
	});
});
