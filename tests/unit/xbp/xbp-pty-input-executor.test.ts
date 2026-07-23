import { describe, expect, it, vi } from "vitest";
import { createXbpPtyInputExecutor } from "../../../services/xbp/xbp-pty-input-executor";
import { PtyInputResult } from "@ai-creed/command-contract";
import type { PtyInputAuditEntry } from "../../../services/diagnostics/pty-input-audit-logger";

const CHUNKS = [{ text: "y" as const }, { key: "enter" as const }];
const ARGS = { worktreeId: "wt-1", agentId: "a-1", chunks: CHUNKS };

function makeExecutor(
	over: {
		enabled?: boolean;
		resolved?: { terminalSessionId: string } | undefined;
		writeIfLive?: (id: string, data: string) => boolean;
	} = {},
) {
	const audit: PtyInputAuditEntry[] = [];
	const logInternal = vi.fn();
	const writeIfLive = vi.fn(over.writeIfLive ?? (() => true));
	const executor = createXbpPtyInputExecutor({
		isPtyInputEnabled: () => over.enabled ?? true,
		resolvePty: () =>
			"resolved" in over ? over.resolved : { terminalSessionId: "ts-1" },
		writeIfLive,
		auditPtyInput: (e) => audit.push(e),
		logInternal,
		now: () => 1753221600000,
	});
	return { executor, audit, writeIfLive, logInternal };
}

describe("createXbpPtyInputExecutor", () => {
	it("applies: translates in order, writes once, returns appliedAt, audits ONE apply entry with literal chunks", async () => {
		const { executor, audit, writeIfLive } = makeExecutor();
		const res = await executor.handle(ARGS);
		expect(res).toEqual({ ok: true, appliedAt: 1753221600000 });
		expect(writeIfLive).toHaveBeenCalledTimes(1);
		expect(writeIfLive).toHaveBeenCalledWith("ts-1", "y\r");
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			route: "apply",
			rejectCode: null,
			worktreeId: "wt-1",
			agentId: "a-1",
			chunks: CHUNKS,
		});
	});

	it("disarmed: pty-input-disabled, no resolve/write, single reject entry with chunks", async () => {
		const { executor, audit, writeIfLive } = makeExecutor({ enabled: false });
		const res = await executor.handle(ARGS);
		expect(res).toMatchObject({ ok: false, code: "pty-input-disabled" });
		expect(writeIfLive).not.toHaveBeenCalled();
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			route: "reject",
			rejectCode: "pty-input-disabled",
			chunks: CHUNKS,
		});
	});

	it("unknown target: no-such-pty before any write", async () => {
		const { executor, audit, writeIfLive } = makeExecutor({
			resolved: undefined,
		});
		const res = await executor.handle(ARGS);
		expect(res).toMatchObject({ ok: false, code: "no-such-pty" });
		expect(writeIfLive).not.toHaveBeenCalled();
		expect(audit[0]).toMatchObject({
			route: "reject",
			rejectCode: "no-such-pty",
		});
	});

	it("not live at the seam: no-live-agent (Bug-1 analogue — the seam refused, nothing written)", async () => {
		const { executor, audit } = makeExecutor({ writeIfLive: () => false });
		const res = await executor.handle(ARGS);
		expect(res).toMatchObject({ ok: false, code: "no-live-agent" });
		expect(audit[0]).toMatchObject({
			route: "reject",
			rejectCode: "no-live-agent",
			chunks: CHUNKS,
		});
	});

	it("write throws: sanitized internal — the FIXED generic message, path-free; single reject entry with chunks; raw detail host-only (Bug-2 analogue)", async () => {
		const boom = new Error("EBADF: write failed at /Users/vuphan/secret/path");
		const { executor, audit, logInternal } = makeExecutor({
			writeIfLive: () => {
				throw boom;
			},
		});
		const res = await executor.handle(ARGS);
		expect(res).toEqual({
			ok: false,
			code: "internal",
			message: "internal error during pty-input",
		});
		expect(PtyInputResult.safeParse(res).success).toBe(true);
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			route: "reject",
			rejectCode: "internal",
			chunks: CHUNKS,
		});
		expect(logInternal).toHaveBeenCalledTimes(1);
		expect(String(logInternal.mock.calls[0][0])).toContain("EBADF");
	});

	it("never throws for any refusal path and every result is schema-valid with a fixed path-free message", async () => {
		for (const make of [
			() => makeExecutor({ enabled: false }),
			() => makeExecutor({ resolved: undefined }),
			() => makeExecutor({ writeIfLive: () => false }),
			() =>
				makeExecutor({
					writeIfLive: () => {
						throw new Error("x at /host/path");
					},
				}),
		]) {
			const { executor } = make();
			const res = await executor.handle(ARGS);
			expect(PtyInputResult.safeParse(res).success).toBe(true);
			if (!res.ok && res.message !== undefined) {
				expect(res.message).not.toContain("/");
				expect(res.message.length).toBeLessThanOrEqual(200);
			}
		}
	});
});
