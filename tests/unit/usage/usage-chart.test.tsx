// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageChart } from "../../../src/features/telemetry/UsageChart.js";
import type { DailyPoint, ProviderTelemetryInfo } from "../../../shared/models/usage.js";

const providers: ProviderTelemetryInfo[] = [
	{ id: "claude", label: "Claude", brand: "var(--provider-claude)", capabilities: { tokenLog: true, storeKind: "jsonl-tree", timeSource: "per-event", cwdSource: "in-line", nativeLimits: false }, hasData: true },
	{ id: "codex", label: "Codex", brand: "var(--provider-codex)", capabilities: { tokenLog: true, storeKind: "jsonl-tree", timeSource: "per-event", cwdSource: "in-line", nativeLimits: true }, hasData: true },
];
const NOW = new Date("2026-06-17T12:00:00").getTime(); // a weekday; both days fall in its week
const DAY = 86_400_000;
const series: DailyPoint[] = [
	{ dayStartMs: NOW - DAY, tokens: { claude: 10, codex: 4 } },
	{ dayStartMs: NOW, tokens: { claude: 6 } },
];

describe("UsageChart", () => {
	it("renders one bar per day and a segment per provider with data", () => {
		const { container } = render(
			<UsageChart series={series} providers={providers} range="week" nowMs={NOW} />,
		);
		expect(container.querySelectorAll(".usage-chart-bar")).toHaveLength(2);
		// day 0 has claude+codex (2 segments); day 1 has claude only (1)
		expect(container.querySelectorAll(".usage-chart-seg")).toHaveLength(3);
	});
});
