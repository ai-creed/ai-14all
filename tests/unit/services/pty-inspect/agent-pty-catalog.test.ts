import { describe, expect, it, vi } from "vitest";
import { AgentPtyCatalog } from "../../../../services/pty-inspect/agent-pty-catalog";
import { PtyMirror } from "../../../../services/pty-inspect/pty-mirror";

function harness(opts?: { intentTimeoutMs?: number }) {
	const mirrors = new Map<string, PtyMirror>();
	const catalog = new AgentPtyCatalog(opts);
	catalog.attachMirrorSource({
		getMirror: (id) => mirrors.get(id),
		takeMirror: (id) => {
			const m = mirrors.get(id);
			mirrors.delete(id);
			return m;
		},
	});
	const spawn = (id: string) => {
		const m = new PtyMirror({ cols: 80, rows: 24 });
		mirrors.set(id, m);
		return m;
	};
	const upsert = (
		over: Partial<Parameters<AgentPtyCatalog["upsert"]>[0]> = {},
	) =>
		catalog.upsert({
			worktreeId: "wt-1",
			agentId: "proc-1",
			terminalSessionId: "term-1",
			provider: "claude",
			label: "claude",
			live: true,
			agentDetected: true,
			...over,
		});
	return { catalog, spawn, upsert };
}

describe("AgentPtyCatalog", () => {
	it("enumerates only agent-detected entries and stays sticky through detection reset (spec §1.2)", () => {
		const { catalog, spawn, upsert } = harness();
		spawn("term-1");
		upsert();
		expect(catalog.listPtys("wt-1")).toHaveLength(1);
		// Renderer resets agentDetected on exit — entry must stay enumerable.
		upsert({ agentDetected: false, live: false });
		expect(catalog.listPtys("wt-1")).toHaveLength(1);
		catalog.upsert({
			worktreeId: "wt-1",
			agentId: "shell-1",
			terminalSessionId: "term-9",
			provider: null,
			label: "zsh",
			live: true,
			agentDetected: false,
		});
		expect(catalog.listPtys("wt-1")).toHaveLength(1); // plain shell never appears
	});

	it("correlated exit marks live:false after drain and emits the final hint (spec §§1.3/3)", async () => {
		const { catalog, spawn, upsert } = harness();
		const m = spawn("term-1");
		upsert();
		const events: string[] = [];
		catalog.onEvent((ev) => events.push(ev.kind));
		m.write("final row\r\n"); // still parsing when exit lands
		await catalog.handleTerminalExit("term-1");
		const entry = catalog.getEntry("wt-1", "proc-1");
		expect(entry?.live).toBe(false);
		expect(entry?.mirror.snapshotLineText(0)).toBe("final row"); // drain won the race
		expect(events).toContain("exit-final-hint");
	});

	it("stale exit after rebind is a no-op (spec §6.15 late ordering)", async () => {
		const { catalog, spawn, upsert } = harness();
		spawn("term-1");
		upsert();
		spawn("term-2");
		upsert({ terminalSessionId: "term-2" }); // rebind before old exit arrives
		await catalog.handleTerminalExit("term-1"); // late old exit
		expect(catalog.getEntry("wt-1", "proc-1")?.live).toBe(true);
		expect(catalog.listPtys("wt-1")).toHaveLength(1);
	});

	it("rebind intent suppresses early exit teardown until the replacement binds (spec §6.15 early ordering)", async () => {
		const { catalog, spawn, upsert } = harness();
		spawn("term-1");
		upsert();
		const events: string[] = [];
		catalog.onEvent((ev) => events.push(ev.kind));
		catalog.rebindIntent("wt-1", "proc-1");
		await catalog.handleTerminalExit("term-1"); // exit during stopSession
		expect(catalog.getEntry("wt-1", "proc-1")?.live).toBe(true); // suppressed
		expect(events).not.toContain("exit-final-hint");
		spawn("term-2");
		upsert({ terminalSessionId: "term-2" });
		expect(catalog.getEntry("wt-1", "proc-1")?.live).toBe(true);
		expect(events).toContain("rebound");
	});

	it("intent expiry releases the deferred exit publication (spec §1.3)", async () => {
		vi.useFakeTimers();
		const { catalog, spawn, upsert } = harness({ intentTimeoutMs: 1000 });
		spawn("term-1");
		upsert();
		catalog.rebindIntent("wt-1", "proc-1");
		await catalog.handleTerminalExit("term-1");
		expect(catalog.getEntry("wt-1", "proc-1")?.live).toBe(true);
		await vi.advanceTimersByTimeAsync(1001);
		expect(catalog.getEntry("wt-1", "proc-1")?.live).toBe(false);
		vi.useRealTimers();
	});

	it("rebind presents a strictly greater epoch immediately, before any further bump (spec §1.3/§6.12)", () => {
		const { catalog, spawn, upsert } = harness();
		const m1 = spawn("term-1");
		upsert();
		m1.resize(100, 30); // advance old epoch
		const oldEpoch = m1.epoch;
		spawn("term-2");
		upsert({ terminalSessionId: "term-2" });
		const entry = catalog.getEntry("wt-1", "proc-1");
		expect(entry).toBeDefined();
		// No resize/bump on the new mirror: the rebound hint and the first
		// replacement pull must already see epoch > every epoch the old
		// terminal served.
		expect(entry!.mirror.epoch).toBeGreaterThan(oldEpoch);
	});

	it("renderer reload replay: idempotent re-upsert preserves the bound mirror (spec §6.10)", () => {
		const { catalog, spawn, upsert } = harness();
		spawn("term-1");
		upsert();
		const before = catalog.getEntry("wt-1", "proc-1");
		upsert(); // replayed identical upsert after a renderer reload
		const after = catalog.getEntry("wt-1", "proc-1");
		expect(after?.mirror).toBe(before?.mirror); // same instance — no rebind, no reset
		expect(catalog.listPtys("wt-1")).toHaveLength(1);
	});

	it("remove disposes the retained mirror and drops the entry (spec §6.9)", async () => {
		const { catalog, spawn, upsert } = harness();
		spawn("term-1");
		upsert();
		await catalog.handleTerminalExit("term-1");
		catalog.remove("wt-1", "proc-1");
		expect(catalog.getEntry("wt-1", "proc-1")).toBeUndefined();
		expect(catalog.listPtys("wt-1")).toHaveLength(0);
	});
});
