// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageStrip } from "../../../src/features/telemetry/UsageStrip.js";
import type { UsageSnapshot } from "../../../shared/models/usage.js";

const NOW = 1_000_000_000_000;
const snapshot: UsageSnapshot = {
	generatedAtMs: NOW,
	limits: [
		{ provider: "claude", real: false, fiveHour: { percent: 10, resetsAtMs: null }, weekly: { percent: 20, resetsAtMs: null, used: null, budget: null } },
		{ provider: "codex", real: true, fiveHour: { percent: 5, resetsAtMs: null }, weekly: { percent: 8, resetsAtMs: null, used: null, budget: null } },
	],
	rows: [],
	totals: { input: 0, output: 0, billable: 0, raw: 0 },
	config: { fiveHourBudget: 0, weeklyBudget: 0, weeklyResetDay: 0, weeklyResetHour: 0 },
};

describe("UsageStrip installed-provider filter", () => {
	it("shows only installed providers when installedProviders is set", () => {
		render(<UsageStrip snapshot={snapshot} currentWorktreePath={null} installedProviders={["codex"]} />);
		expect(screen.getByText("codex")).toBeInTheDocument();
		expect(screen.queryByText("claude")).not.toBeInTheDocument();
	});
	it("shows all providers when installedProviders is omitted (pre-load)", () => {
		render(<UsageStrip snapshot={snapshot} currentWorktreePath={null} />);
		expect(screen.getByText("claude")).toBeInTheDocument();
		expect(screen.getByText("codex")).toBeInTheDocument();
	});
});
