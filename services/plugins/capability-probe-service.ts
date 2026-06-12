import { execFile as nodeExecFile } from "node:child_process";
import type {
	AgentCliProbe,
	AgentCliProbes,
	ProbeResult,
} from "../../shared/models/ecosystem-plugin.js";
import { resolveBinary, type ResolvedBinary } from "./binary-resolver.js";

export type CapabilityProbeService = {
	/** Cached probe of the agent CLIs (claude, codex) — prerequisite notice. */
	probeAgentClis(): Promise<AgentCliProbes>;
	/** Cached wrapper around a plugin driver's own probe. */
	probePlugin(
		id: string,
		rawProbe: () => Promise<ProbeResult>,
	): Promise<ProbeResult>;
	/** Drop every cached result — the re-probe triggers all land here. */
	invalidate(): void;
};

const AGENT_CLIS = ["claude", "codex"] as const;

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

	async function probeAgentCli(name: string): Promise<AgentCliProbe> {
		const binary = await resolve(name, { timeoutMs });
		if (binary === null) return { kind: "not-found" };
		return {
			kind: "found",
			path: binary.command,
			version: await readVersion(binary),
		};
	}

	return {
		probeAgentClis() {
			return cached("agents", async () => {
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
