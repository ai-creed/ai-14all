// Regression for the AppTimeArea tooltip finding: APP_TIME_CONFIG must stay
// keyed by the SAME dataKeys the widget's two <Area> series use
// ("focusedMs"/"engagedMs"), not the prototype's short names ("focused"/
// "engaged") — ChartTooltipContent resolves a series' human label via
// config[dataKey], so a mismatch here silently falls through to the raw
// dataKey in the tooltip. Exercised two ways, NEITHER of which needs
// Recharts/ResponsiveContainer to actually lay out a chart (it does not
// render its children in this repo's zero-layout jsdom test env — see
// AppTimeArea.tsx's own module doc):
//   1. a direct key-set assertion against APP_TIME_CONFIG, and
//   2. rendering ChartTooltipContent itself (a plain presentational
//      component, independent of Recharts layout) with a payload shaped
//      exactly like what Recharts hands it for these two series.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartTooltipContent } from "../../../../../src/components/ui/chart.js";
import { APP_TIME_CONFIG } from "../../../../../src/features/insights/widgets/AppTimeArea.js";

describe("AppTimeArea tooltip config", () => {
	it("APP_TIME_CONFIG is keyed by the widget's own dataKeys (focusedMs/engagedMs)", () => {
		expect(Object.keys(APP_TIME_CONFIG).sort()).toEqual(
			["engagedMs", "focusedMs"].sort(),
		);
		expect(APP_TIME_CONFIG.focusedMs.label).toBe("focused");
		expect(APP_TIME_CONFIG.engagedMs.label).toBe("engaged");
	});

	it("ChartTooltipContent, given APP_TIME_CONFIG and a focusedMs/engagedMs payload, shows human names — not the raw dataKeys", () => {
		render(
			<ChartTooltipContent
				active
				config={APP_TIME_CONFIG}
				label="1234"
				payload={[
					{ dataKey: "focusedMs", value: 60_000, color: "red" },
					{ dataKey: "engagedMs", value: 30_000, color: "blue" },
				]}
			/>,
		);
		expect(screen.getByText(/^focused:/)).toBeInTheDocument();
		expect(screen.getByText(/^engaged:/)).toBeInTheDocument();
		expect(screen.queryByText(/focusedMs/)).not.toBeInTheDocument();
		expect(screen.queryByText(/engagedMs/)).not.toBeInTheDocument();
	});
});
