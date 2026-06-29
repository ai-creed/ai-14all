import type { AgentProviderId } from "../../../shared/models/agent-provider.js";
import type {
	LimitGauge,
	ProviderRateLimits,
	ProviderTelemetryCapabilities,
	UsageEvent,
} from "../../../shared/models/usage.js";

// Opaque per-file parse state, threaded across appended lines and persisted in
// the offset cache. Codex threads cwd/model; ezio stores the dir-slug; claude
// needs nothing.
export type ParseCtx = Record<string, string>;

export interface JsonlLineResult {
	event?: UsageEvent; // a token event to aggregate
	limits?: ProviderRateLimits; // provider-reported limits (nativeLimits only)
}

export interface GaugeContext {
	providerLimits: ProviderRateLimits | null; // latest captured for this provider
	nowMs: number;
}

export interface TelemetryDriver {
	id: AgentProviderId;
	capabilities: ProviderTelemetryCapabilities;
	roots(home: string): string[]; // [] unless storeKind === "jsonl-tree"

	// jsonl-tree only:
	keep?(line: string): boolean; // pre-JSON.parse marker gate (perf contract)
	seedCtx?(file: string): ParseCtx; // e.g. dir-slug (ezio), sessionId (codex)
	parseLine?(line: string, ctx: ParseCtx): JsonlLineResult; // may mutate ctx
	// Back-compat ctx recovery: re-derive threaded ctx (cwd/model) from a meta-only
	// re-scan of [0, upToOffset) without re-ingesting events. Only codex needs it.
	recoverCtx?(file: string, upToOffset: number): ParseCtx;

	// nativeLimits only:
	buildGauge?(ctx: GaugeContext): LimitGauge; // codex 5h/weekly real gauge
}
