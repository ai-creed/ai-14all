import { describe, expect, it } from "vitest";
import { AgentPtyCatalog } from "../../../../services/pty-inspect/agent-pty-catalog";
import { PtyMirror } from "../../../../services/pty-inspect/pty-mirror";
import { PtySubscriptionRegistry } from "../../../../services/pty-inspect/pty-subscription-registry";

async function harness() {
	const mirrors = new Map<string, PtyMirror>();
	const catalog = new AgentPtyCatalog();
	catalog.attachMirrorSource({
		getMirror: (id) => mirrors.get(id),
		takeMirror: (id) => {
			const m = mirrors.get(id);
			mirrors.delete(id);
			return m;
		},
	});
	const m = new PtyMirror({ cols: 40, rows: 6 });
	mirrors.set("term-1", m);
	catalog.upsert({
		worktreeId: "wt-1",
		agentId: "proc-1",
		terminalSessionId: "term-1",
		provider: "claude",
		label: "claude",
		live: true,
		agentDetected: true,
	});
	const hints: Array<{ epoch: number; watermark: number }> = [];
	const registry = new PtySubscriptionRegistry({
		catalog,
		emitHint: (p) => hints.push(p),
		tickMs: 5,
	});
	const entry = catalog.getEntry("wt-1", "proc-1");
	if (!entry) throw new Error("entry missing");
	return { catalog, registry, mirror: entry.mirror, hints };
}

describe("PtySubscriptionRegistry", () => {
	it("subscribe → hint on output; unknown targets refuse structurally", async () => {
		const { registry, mirror, hints } = await harness();
		expect(registry.subscribe("wt-1", "nope")).toEqual({
			ok: false,
			code: "no-such-pty",
		});
		const sub = registry.subscribe("wt-1", "proc-1");
		expect(sub).toMatchObject({ ok: true, cols: 40 });
		mirror.write("hello\r\n");
		await mirror.drained();
		await new Promise((r) => setTimeout(r, 25));
		expect(hints.length).toBeGreaterThanOrEqual(1);
	});

	it("replacement: second subscribe replaces the first; no hint leaks for the abandoned target (spec §6.8)", async () => {
		const { catalog, registry, mirror, hints } = await harness();
		// second agent
		const m2 = new PtyMirror({ cols: 40, rows: 6 });
		catalog.attachMirrorSource({
			getMirror: () => m2,
			takeMirror: () => m2,
		});
		catalog.upsert({
			worktreeId: "wt-1",
			agentId: "proc-2",
			terminalSessionId: "term-2",
			provider: "codex",
			label: "codex",
			live: true,
			agentDetected: true,
		});
		const ops: string[] = [];
		registry.onLifecycle((ev) => ops.push(ev.op));
		registry.subscribe("wt-1", "proc-1");
		registry.subscribe("wt-1", "proc-2"); // replaces
		hints.length = 0;
		mirror.write("abandoned target output\r\n");
		await mirror.drained();
		await new Promise((r) => setTimeout(r, 25));
		expect(hints).toHaveLength(0); // old target no longer hints
		expect(ops).toContain("replace");
	});

	it("resize while subscribed emits a coalesced hint carrying the new epoch (spec §6.3)", async () => {
		const { registry, mirror, hints } = await harness();
		registry.subscribe("wt-1", "proc-1");
		hints.length = 0;
		mirror.resize(60, 8); // epoch-only change: no dirty write, no tick involvement
		await new Promise((r) => setTimeout(r, 25)); // past the harness's 5ms coalesce window
		expect(hints.at(-1)?.epoch).toBe(mirror.epoch);
	});

	it("a resize storm coalesces within the hint budget; the final hint carries the latest epoch (spec §5)", async () => {
		const { registry, mirror, hints } = await harness(); // tickMs: 5
		registry.subscribe("wt-1", "proc-1");
		hints.length = 0;
		for (let i = 0; i < 20; i++) mirror.resize(40 + i, 6); // 20 epoch bumps in one burst
		await new Promise((r) => setTimeout(r, 30));
		// One coalesce window was open during the synchronous burst → far fewer
		// hints than bumps (at 200ms production tickMs this is the ≤5/sec budget).
		expect(hints.length).toBeLessThanOrEqual(3);
		expect(hints.at(-1)?.epoch).toBe(mirror.epoch);
	});

	it("renderer reload: a replayed identical upsert leaves the subscription and hints intact (spec §6.10)", async () => {
		const { catalog, registry, mirror, hints } = await harness();
		registry.subscribe("wt-1", "proc-1");
		catalog.upsert({
			worktreeId: "wt-1",
			agentId: "proc-1",
			terminalSessionId: "term-1",
			provider: "claude",
			label: "claude",
			live: true,
			agentDetected: true,
		}); // renderer reload replays the same catalog entry
		hints.length = 0;
		mirror.write("after reload\r\n");
		await mirror.drained();
		await new Promise((r) => setTimeout(r, 25));
		expect(hints.length).toBeGreaterThanOrEqual(1); // subscription survived
		const page = await registry.pullRows("wt-1", "proc-1", null);
		expect(page).toMatchObject({ ok: true }); // same mirror still serves
	});

	it("rebound hint is coalesced, bounded, and carries the strictly greater replacement epoch (spec §6.12)", async () => {
		const { catalog, registry, mirror, hints } = await harness();
		registry.subscribe("wt-1", "proc-1");
		mirror.resize(50, 6); // advance the old terminal's epoch
		await new Promise((r) => setTimeout(r, 25)); // drain the resize's own coalesced hint
		const oldEpoch = mirror.epoch;
		const m2 = new PtyMirror({ cols: 40, rows: 6 });
		catalog.attachMirrorSource({ getMirror: () => m2, takeMirror: () => m2 });
		hints.length = 0;
		catalog.upsert({
			worktreeId: "wt-1",
			agentId: "proc-1",
			terminalSessionId: "term-2",
			provider: "claude",
			label: "claude",
			live: true,
			agentDetected: true,
		});
		// The hint flows through the per-subscription coalescer — wait past the
		// harness's 5ms window before asserting.
		await new Promise((r) => setTimeout(r, 25));
		expect(hints).toHaveLength(1); // exactly one bounded rebind hint
		expect(hints[0]?.epoch).toBeGreaterThan(oldEpoch);
	});

	it("pull through the registry counts rowsServed and refuses after teardown", async () => {
		const { catalog, registry, mirror } = await harness();
		const ops: Array<{ op: string; cause?: string }> = [];
		registry.onLifecycle((ev) => ops.push({ op: ev.op, cause: ev.cause }));
		registry.subscribe("wt-1", "proc-1");
		mirror.write("a\r\nb\r\n");
		await mirror.drained();
		mirror.tick();
		const page = await registry.pullRows("wt-1", "proc-1", null);
		expect(page).toMatchObject({ ok: true });
		expect(registry.rowsServedTotal()).toBeGreaterThan(0);
		catalog.remove("wt-1", "proc-1"); // catalog "disposed" event with an active subscription
		expect(ops).toContainEqual({ op: "teardown", cause: "session-teardown" });
		await expect(registry.pullRows("wt-1", "proc-1", null)).resolves.toEqual({
			ok: false,
			code: "no-such-pty",
		});
	});

	it("exit-final-hint with an active subscription: direct final hint, agent-exit teardown, then silence (spec §6.6)", async () => {
		const { catalog, registry, mirror, hints } = await harness();
		const ops: Array<{ op: string; cause?: string }> = [];
		registry.onLifecycle((ev) => ops.push({ op: ev.op, cause: ev.cause }));
		registry.subscribe("wt-1", "proc-1");
		mirror.write("last row before exit\r\n");
		await mirror.drained();
		hints.length = 0;
		await catalog.handleTerminalExit("term-1");
		// The final hint fires directly (not coalesced) before teardown, so it
		// is observable immediately after the awaited exit — no extra wait.
		expect(hints.length).toBeGreaterThanOrEqual(1);
		expect(ops).toContainEqual({ op: "teardown", cause: "agent-exit" });
		hints.length = 0;
		mirror.write("post-exit output\r\n"); // retained mirror, no subscriber left
		await mirror.drained();
		await new Promise((r) => setTimeout(r, 25));
		expect(hints).toHaveLength(0); // subscription gone — no further hints
		const page = await registry.pullRows("wt-1", "proc-1", null);
		expect(page).toMatchObject({ ok: true }); // pty-rows still serves the dead terminal
	});

	it("subscribe refuses no-live-agent after exit while pty-rows still serves (spec §3)", async () => {
		const { catalog, registry, mirror } = await harness();
		mirror.write("kept\r\n");
		await catalog.handleTerminalExit("term-1");
		expect(registry.subscribe("wt-1", "proc-1")).toEqual({
			ok: false,
			code: "no-live-agent",
		});
		const page = await registry.pullRows("wt-1", "proc-1", null);
		expect(page).toMatchObject({ ok: true });
	});

	it("teardown drops the subscription with its cause (peer detach / re-pair)", async () => {
		const { registry, mirror, hints } = await harness();
		const ops: Array<{ op: string; cause?: string }> = [];
		registry.onLifecycle((ev) => ops.push({ op: ev.op, cause: ev.cause }));
		registry.subscribe("wt-1", "proc-1");
		registry.teardown("re-pair");
		hints.length = 0;
		mirror.write("post-teardown\r\n");
		await mirror.drained();
		await new Promise((r) => setTimeout(r, 25));
		expect(hints).toHaveLength(0);
		expect(ops).toContainEqual({ op: "teardown", cause: "re-pair" });
	});
});
