import { describe, expect, it, vi } from "vitest";
import { createCapabilityProbeService } from "../../../services/plugins/capability-probe-service";

function makeService(overrides: Record<string, unknown> = {}) {
	const resolveBinaryImpl = vi.fn(async (name: string) =>
		name === "claude" ? { command: "/bin/claude", prefixArgs: [] } : null,
	);
	const execFileImpl = vi.fn(
		(
			_cmd: string,
			_args: string[],
			_opts: unknown,
			cb: (e: Error | null, stdout: string, stderr: string) => void,
		) => cb(null, "1.2.3\n", ""),
	);
	let nowMs = 0;
	const service = createCapabilityProbeService({
		resolveBinaryImpl: resolveBinaryImpl as never,
		execFileImpl: execFileImpl as never,
		now: () => nowMs,
		ttlMs: 60_000,
		...overrides,
	});
	return {
		service,
		resolveBinaryImpl,
		advance: (ms: number) => {
			nowMs += ms;
		},
	};
}

describe("createCapabilityProbeService", () => {
	it("probes agent CLIs: found with version, missing as not-found", async () => {
		const { service } = makeService();
		const result = await service.probeAgentClis();
		expect(result.claude).toEqual({
			kind: "found",
			path: "/bin/claude",
			version: "1.2.3",
		});
		expect(result.codex).toEqual({ kind: "not-found" });
	});

	it("caches results until the ttl expires", async () => {
		const { service, resolveBinaryImpl, advance } = makeService();
		await service.probeAgentClis();
		await service.probeAgentClis();
		expect(resolveBinaryImpl).toHaveBeenCalledTimes(3); // claude + codex + ezio, once
		advance(61_000);
		await service.probeAgentClis();
		expect(resolveBinaryImpl).toHaveBeenCalledTimes(6);
	});

	it("invalidate() forces a fresh probe", async () => {
		const { service, resolveBinaryImpl } = makeService();
		await service.probeAgentClis();
		service.invalidate();
		await service.probeAgentClis();
		expect(resolveBinaryImpl).toHaveBeenCalledTimes(6);
	});

	it("concurrent callers share one in-flight probe", async () => {
		const { service, resolveBinaryImpl } = makeService();
		await Promise.all([service.probeAgentClis(), service.probeAgentClis()]);
		expect(resolveBinaryImpl).toHaveBeenCalledTimes(3);
	});

	it("version failure degrades to version null, never a throw", async () => {
		const { service } = makeService({
			execFileImpl: ((
				_cmd: string,
				_args: string[],
				_opts: unknown,
				cb: (e: Error | null, stdout: string, stderr: string) => void,
			) => cb(new Error("boom"), "", "")) as never,
		});
		const result = await service.probeAgentClis();
		expect(result.claude).toEqual({
			kind: "found",
			path: "/bin/claude",
			version: null,
		});
	});

	it("probePlugin caches the wrapped probe and shares invalidation", async () => {
		const { service } = makeService();
		const raw = vi.fn(async () => ({ kind: "not-installed" as const }));
		await service.probePlugin("whisper", raw);
		await service.probePlugin("whisper", raw);
		expect(raw).toHaveBeenCalledTimes(1);
		service.invalidate();
		await service.probePlugin("whisper", raw);
		expect(raw).toHaveBeenCalledTimes(2);
	});

	it("probes ezio: found via resolveBinary, version parsed from `ezio doctor`", async () => {
		const resolveBinaryImpl = vi.fn(async (name: string) =>
			name === "ezio" ? { command: "/bin/ezio", prefixArgs: [] } : null,
		);
		const execFileImpl = vi.fn(
			(
				_cmd: string,
				args: string[],
				_opts: unknown,
				cb: (e: Error | null, stdout: string, stderr: string) => void,
			) => {
				if (args.includes("doctor"))
					return cb(null, "checks ok\nezio version : 0.2.0-beta.3\n", "");
				return cb(null, "should-not-be-used\n", "");
			},
		);
		const service = createCapabilityProbeService({
			resolveBinaryImpl: resolveBinaryImpl as never,
			execFileImpl: execFileImpl as never,
		});
		const result = await service.probeAgentClis();
		expect(result.ezio).toEqual({
			kind: "found",
			path: "/bin/ezio",
			version: "0.2.0-beta.3",
		});
		expect(
			execFileImpl.mock.calls.some(
				(c) => c[0] === "/bin/ezio" && (c[1] as string[]).includes("--version"),
			),
		).toBe(false);
	});

	it("ezio doctor failure degrades to version null, still found", async () => {
		const resolveBinaryImpl = vi.fn(async (name: string) =>
			name === "ezio" ? { command: "/bin/ezio", prefixArgs: [] } : null,
		);
		const execFileImpl = vi.fn(
			(
				_cmd: string,
				_args: string[],
				_opts: unknown,
				cb: (e: Error | null, stdout: string, stderr: string) => void,
			) => cb(new Error("boom"), "", ""),
		);
		const service = createCapabilityProbeService({
			resolveBinaryImpl: resolveBinaryImpl as never,
			execFileImpl: execFileImpl as never,
		});
		const result = await service.probeAgentClis();
		expect(result.ezio).toEqual({
			kind: "found",
			path: "/bin/ezio",
			version: null,
		});
	});
});
