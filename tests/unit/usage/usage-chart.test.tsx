// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageChart } from "../../../src/features/telemetry/UsageChart.js";
import type {
	DailyPoint,
	ProviderTelemetryInfo,
} from "../../../shared/models/usage.js";

const providers: ProviderTelemetryInfo[] = [
	{
		id: "claude",
		label: "Claude",
		brand: "var(--provider-claude)",
		capabilities: {
			tokenLog: true,
			storeKind: "jsonl-tree",
			timeSource: "per-event",
			cwdSource: "in-line",
			nativeLimits: false,
		},
		hasData: true,
	},
	{
		id: "codex",
		label: "Codex",
		brand: "var(--provider-codex)",
		capabilities: {
			tokenLog: true,
			storeKind: "jsonl-tree",
			timeSource: "per-event",
			cwdSource: "in-line",
			nativeLimits: true,
		},
		hasData: true,
	},
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
			<UsageChart
				kind="daily"
				daily={series}
				providers={providers}
				range="week"
				nowMs={NOW}
			/>,
		);
		expect(container.querySelectorAll(".usage-chart-bar")).toHaveLength(2);
		// day 0 has claude+codex (2 segments); day 1 has claude only (1)
		expect(container.querySelectorAll(".usage-chart-seg")).toHaveLength(3);
	});
	it("renders nothing when the slice is empty", () => {
		const { container } = render(
			<UsageChart
				kind="daily"
				daily={[]}
				providers={providers}
				range="week"
				nowMs={NOW}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});
	it("renders weekday labels and marks today when showDayLabels is set", () => {
		const { container } = render(
			<UsageChart
				kind="daily"
				daily={series}
				providers={providers}
				range="week"
				nowMs={NOW}
				showDayLabels
			/>,
		);
		const labels = container.querySelectorAll(".usage-chart-label");
		expect(labels).toHaveLength(2); // Tue 06-16, Wed 06-17
		// NOW = Wed 2026-06-17 → today's label is "We" and carries the is-today accent.
		const today = container.querySelector(".usage-chart-label.is-today");
		expect(today?.textContent).toBe("We");
		// today's column is also tick-marked
		expect(
			container.querySelectorAll(".usage-chart-bar.is-today"),
		).toHaveLength(1);
	});
	it("omits weekday labels without showDayLabels (e.g. the chip)", () => {
		const { container } = render(
			<UsageChart
				kind="daily"
				daily={series}
				providers={providers}
				range="week"
				nowMs={NOW}
			/>,
		);
		expect(container.querySelectorAll(".usage-chart-label")).toHaveLength(0);
		expect(
			container.querySelectorAll(".usage-chart-bar.is-today"),
		).toHaveLength(0);
	});
});
