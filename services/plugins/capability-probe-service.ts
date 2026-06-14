import { execFile as nodeExecFile } from "node:child_process";
import type {
	AgentCliProbe,
	AgentCliProbes,
	ProbeResult,
} from "../../shared/models/ecosystem-plugin.js";
import { resolveBinary, type ResolvedBinary } from "./binary-resolver.js";

export type CapabilityProbeService = {
	/** Cached probe of the agent CLIs (claude, codex, ezio) — prerequisite notice. */
	probeAgentClis(): Promise<AgentCliProbes>;
	/** Cached wrapper around a plugin driver's own probe. */
	probePlugin(
		id: string,
		rawProbe: () => Promise<ProbeResult>,
	): Promise<ProbeResult>;
	/** Drop every cached result — the re-probe triggers all land here. */
	invalidate(): void;
};

const AGENT_CLIS = ["claude", "codex", "ezio"] as const;

export function createCapabilityProbeService(
	options: {
		resolveBinaryImpl?: typeof resolveBinary;
		execFileImpl?: typeof nodeExecFile;
		now?: () => number;
		ttlMs?: number;
		timeoutMs?: number;
	} = {},
): CapabilityProbeService {
	const resolve = options.resolveBinaryImpl ?? resolveBinary;
	const execFile = options.execFileImpl ?? nodeExecFile;
	const now = options.now ?? (() => Date.now());
	const ttlMs = options.ttlMs ?? 60_000;
	const timeoutMs = options.timeoutMs ?? 5000;

	// One cache for everything the service probes (keys: "agents",
	// "plugin:<id>"). The in-flight promise is cached immediately, so
	// concurrent callers share a single child process.
	const cache = new Map<string, { at: number; value: Promise<unknown> }>();

	function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
		const hit = cache.get(key);
		if (hit && now() - hit.at < ttlMs) return hit.value as Promise<T>;
		const value = produce();
		cache.set(key, { at: now(), value });
		// Current probe sources are total, but the generic helper must not pin
		// a rejection for the full TTL if a future plugin probe ever rejects.
		value.catch(() => {
			if (cache.get(key)?.value === value) cache.delete(key);
		});
		return value;
	}

	function readVersion(binary: ResolvedBinary): Promise<string | null> {
		return new Promise((resolveVersion) => {
			execFile(
				binary.command,
				[...binary.prefixArgs, "--version"],
				{ timeout: timeoutMs },
				(error: Error | null, stdout: string) => {
					if (error) return resolveVersion(null);
					const line = String(stdout).trim().split("\n")[0]?.trim();
					resolveVersion(line && line.length > 0 ? line : null);
				},
			);
		});
	}

	function readEzioVersion(binary: ResolvedBinary): Promise<string | null> {
		// The ezio binary errors on `--version`; `ezio doctor` exits 0 and prints a
		// `ezio version : <x>` line among its health output. Parse best-effort: a
		// missing line (or a non-zero exit) degrades to null, never a throw.
		return new Promise((resolveVersion) => {
			execFile(
				binary.command,
				[...binary.prefixArgs, "doctor"],
				{ timeout: timeoutMs },
				(_error: Error | null, stdout: string) => {
					const match = String(stdout).match(/ezio version\s*:\s*(\S+)/i);
					resolveVersion(match?.[1] ?? null);
				},
			);
		});
	}

	async function probeAgentCli(name: string): Promise<AgentCliProbe> {
		const binary = await resolve(name, { timeoutMs });
		if (binary === null) return { kind: "not-found" };
		return {
			kind: "found",
			path: binary.command,
			version:
				name === "ezio"
					? await readEzioVersion(binary)
					: await readVersion(binary),
		};
	}

	return {
		probeAgentClis() {
			return cached("agents", async () => {
				// E2e seam: agent detection must be deterministic, not depend on the
				// host's installed CLIs (ambient `claude`/`codex`/`ezio` on PATH would,
				// e.g., suppress the default shell). Under AI14ALL_E2E we ignore PATH
				// and report only the agents a test opts in via AI14ALL_FAKE_AGENT_CLIS
				// (comma-separated; unset/empty → none found).
				if (process.env.AI14ALL_E2E === "1") {
					const found = new Set(
						(process.env.AI14ALL_FAKE_AGENT_CLIS ?? "")
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean),
					);
					return Object.fromEntries(
						AGENT_CLIS.map((name) => [
							name,
							found.has(name)
								? { kind: "found", path: `/fake/${name}`, version: null }
								: { kind: "not-found" },
						]),
					) as AgentCliProbes;
				}
				const entries = await Promise.all(
					AGENT_CLIS.map(
						async (name) => [name, await probeAgentCli(name)] as const,
					),
				);
				return Object.fromEntries(entries) as AgentCliProbes;
			});
		},
		probePlugin(id, rawProbe) {
			return cached(`plugin:${id}`, rawProbe);
		},
		invalidate() {
			cache.clear();
		},
	};
}
