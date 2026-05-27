import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..", "fixtures", "codex");

describe("codex-usage.mjs reference tool", () => {
	it("sums only last_token_usage deltas (skips cumulative-only events)", () => {
		const out = execFileSync(
			"node",
			[
				join(__dirname, "..", "..", "..", "scripts", "codex-usage.mjs"),
				`--root=${root}`,
				"--json",
			],
			{ encoding: "utf8" },
		);
		const parsed = JSON.parse(out);
		const day = parsed.daily.find(
			(d: { day: string }) => d.day === "2026-05-21",
		);
		expect(day.total_tokens).toBe(110);
		expect(parsed.latest_limit.secondary_used_percent).toBe(41);
	});
});
