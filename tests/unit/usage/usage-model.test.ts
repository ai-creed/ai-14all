import { describe, expect, it } from "vitest";
import type {
	CostSnapshot,
	DailyPoint,
	ProviderTelemetryCapabilities,
	ProviderTelemetryInfo,
	UsageProvider,
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
