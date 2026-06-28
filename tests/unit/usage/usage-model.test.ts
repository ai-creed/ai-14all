import { describe, expect, it } from "vitest";
import type {
	CostSnapshot,
	DailyPoint,
	ProviderTelemetryCapabilities,
	ProviderTelemetryInfo,
	ScopeData,
	UsageProvider,
	UsageScope,
	UsageSnapshot,
} from "../../../shared/models/usage.js";

describe("usage model shapes", () => {
	it("UsageProvider widens to all five agent ids", () => {
		const ids: UsageProvider[] = [
			"claude",
			"codex",
			"ezio",
			"cursor",
			"antigravity",
		];
		expect(ids).toHaveLength(5);
	});

	it("inert capability descriptor is representable", () => {
		const cap: ProviderTelemetryCapabilities = {
			tokenLog: false,
			storeKind: "none",
			timeSource: "none",
			cwdSource: "none",
			nativeLimits: false,
		};
		const info: ProviderTelemetryInfo = {
			id: "cursor",
			label: "Cursor",
			brand: "var(--provider-cursor)",
			capabilities: cap,
			hasData: false,
		};
		expect(info.capabilities.storeKind).toBe("none");
	});

	it("CostSnapshot tracks unpriced tokens; DailyPoint keys by provider", () => {
		const cost: CostSnapshot = {
			perProvider: { claude: 2.5 },
			total: 2.5,
			currency: "USD",
			notional: true,
			unpricedTokens: 1000,
		};
		const point: DailyPoint = { dayStartMs: 0, tokens: { claude: 5 } };
		expect(cost.unpricedTokens).toBe(1000);
		expect(point.tokens.claude).toBe(5);
	});
});

describe("usage snapshot shape", () => {
	it("a ScopeData literal type-checks with totals/byProvider/rows/cost", () => {
		const sd: ScopeData = {
			scope: "week",
			totalTokens: 7,
			byProvider: [{ provider: "codex", tokens: 7, costUsd: 0.01 }],
			rows: [],
			cost: { perProvider: { codex: 0.01 }, total: 0.01, currency: "USD", notional: true, unpricedTokens: 0 },
		};
		expect(sd.scope).toBe("week");
	});

	it("UsageSnapshot carries all four scopes + both series", () => {
		const scopes = {} as Record<UsageScope, ScopeData>;
		const snap = { generatedAtMs: 0, providers: [], scopes, seriesDaily: [], seriesHourly: [], codexLimits: null, config: { chipRange: "week", includeUntracked: false } } satisfies UsageSnapshot;
		expect(snap.config.chipRange).toBe("week");
	});
});
