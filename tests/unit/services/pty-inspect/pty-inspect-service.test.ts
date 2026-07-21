import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	subscribePtyCapability,
	unsubscribePtyCapability,
} from "@ai-creed/command-contract";
import { PtyInspectService } from "../../../../services/pty-inspect/pty-inspect-service";
import { PtyMirror } from "../../../../services/pty-inspect/pty-mirror";

function makeService(
	resolveWorktree?: (
		worktreeId: string,
	) => Promise<{ workspaceId: string; cwd: string } | null>,
) {
	const logsDir = mkdtempSync(join(tmpdir(), "pty-inspect-service-"));
	return new PtyInspectService({
		logsDir,
		resolveWorktree: resolveWorktree ?? (async () => null),
	});
}

// Seeds one live agent PTY (worktreeId/agentId) backed by a fresh mirror, via
// the same attachMirrorSource + upsert flow production code drives.
function seedPty(
	service: PtyInspectService,
	worktreeId: string,
	agentId: string,
	terminalSessionId: string,
) {
	const mirror = new PtyMirror({ cols: 40, rows: 6 });
	service.catalog.attachMirrorSource({
		getMirror: (id) => (id === terminalSessionId ? mirror : undefined),
		takeMirror: (id) => (id === terminalSessionId ? mirror : undefined),
	});
	service.catalog.upsert({
		worktreeId,
		agentId,
		terminalSessionId,
		provider: "claude",
		label: "claude",
		live: true,
		agentDetected: true,
	});
	return mirror;
}

describe("PtyInspectService", () => {
	it("subscribe/replace lifecycle events land in the audit log under the subscribe-pty capability id", () => {
		const service = makeService();
		seedPty(service, "wt-1", "proc-1", "term-1");
		seedPty(service, "wt-1", "proc-2", "term-2");

		service.registry.subscribe("wt-1", "proc-1");
		service.registry.subscribe("wt-1", "proc-2"); // displaces proc-1 → "replace"

		const entries = service.audit.entries();
		expect(entries).toHaveLength(3);
		expect(entries[0]).toMatchObject({
			op: "subscribe",
			capability: subscribePtyCapability.id,
			worktreeId: "wt-1",
			agentId: "proc-1",
			cause: null,
		});
		expect(entries[1]).toMatchObject({
			op: "replace",
			capability: subscribePtyCapability.id,
			worktreeId: "wt-1",
			agentId: "proc-1",
			cause: null,
		});
		expect(entries[2]).toMatchObject({
			op: "subscribe",
			capability: subscribePtyCapability.id,
			worktreeId: "wt-1",
			agentId: "proc-2",
			cause: null,
		});
	});

	it("unsubscribe lifecycle lands under the unsubscribe-pty capability id", () => {
		const service = makeService();
		seedPty(service, "wt-1", "proc-1", "term-1");
		service.registry.subscribe("wt-1", "proc-1");
		service.registry.unsubscribe("wt-1", "proc-1");

		const entries = service.audit.entries();
		expect(entries).toHaveLength(2);
		expect(entries[1]).toMatchObject({
			op: "unsubscribe",
			capability: unsubscribePtyCapability.id,
			worktreeId: "wt-1",
			agentId: "proc-1",
		});
	});

	it("teardown lifecycle carries the cause and a null capability", () => {
		const service = makeService();
		seedPty(service, "wt-1", "proc-1", "term-1");
		service.registry.subscribe("wt-1", "proc-1");
		service.onPeerDetach();

		const entries = service.audit.entries();
		expect(entries).toHaveLength(2);
		expect(entries[1]).toMatchObject({
			op: "teardown",
			capability: null,
			cause: "peer-detach",
			worktreeId: "wt-1",
			agentId: "proc-1",
		});
	});

	it("auditRefusal appends an op:refusal entry with the given capability id and code", () => {
		const service = makeService();
		service.auditRefusal(
			subscribePtyCapability.id,
			"wt-1",
			"proc-1",
			"no-such-pty",
		);

		const entries = service.audit.entries();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			op: "refusal",
			capability: subscribePtyCapability.id,
			worktreeId: "wt-1",
			agentId: "proc-1",
			refusalCode: "no-such-pty",
			rowsServed: null,
		});
	});

	it("isKnownWorktree reflects the injected resolveWorktree resolver", async () => {
		const service = makeService(async (worktreeId) =>
			worktreeId === "wt-known"
				? { workspaceId: "ws-1", cwd: "/tmp/wt-known" }
				: null,
		);
		await expect(service.isKnownWorktree("wt-known")).resolves.toBe(true);
		await expect(service.isKnownWorktree("wt-unknown")).resolves.toBe(false);
	});

	it("attachTerminalService wires the registry's viewport host to the terminal service", () => {
		const service = makeService();
		seedPty(service, "wt-x", "proc-x", "term-x");
		const calls: string[] = [];
		const fakeTs = {
			getMirror: () => undefined,
			takeMirror: () => undefined,
			applyWatchResize: (id: string, c: number, r: number) =>
				calls.push(`apply:${id}:${c}x${r}`),
			restoreDesktopGeometry: (id: string) => calls.push(`restore:${id}`),
			getDesktopGeometry: () => ({ cols: 120, rows: 40 }),
			setPhoneOwned: (id: string, owned: boolean) =>
				calls.push(`owned:${id}:${owned}`),
		} as never;
		service.attachTerminalService(fakeTs);

		// a refusal proves routing exists; the ok-path is covered by registry tests
		expect(service.registry.setWatchViewport("wt-x", "nope", 46, 40)).toEqual({
			ok: false,
			code: "no-such-pty",
		});

		// attachTerminalService actually wired the host (not left it null): the
		// seeded target now succeeds and drives setPhoneOwned on the terminal.
		expect(
			service.registry.setWatchViewport("wt-x", "proc-x", 46, 40),
		).toEqual({ ok: true });
		expect(calls).toContain("owned:term-x:true");
	});
});
