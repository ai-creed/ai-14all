import { describe, expect, it } from "vitest";
import { WriteSettingsSchema } from "../../../shared/contracts/commands.js";

describe("WriteSettingsSchema", () => {
	it("accepts a partial patch and strips nothing valid", () => {
		expect(WriteSettingsSchema.parse({ patch: { theme: "tui" } })).toEqual({
			patch: { theme: "tui" },
		});
	});
	it("rejects unknown settings keys", () => {
		expect(
			WriteSettingsSchema.safeParse({ patch: { evil: true } }).success,
		).toBe(false);
	});
	it("a partial nested usageTelemetry patch stays partial (no default re-injection)", () => {
		// Regression: UsageTelemetrySettingsSchema's fields each carry their own
		// `.default()`; reusing that schema directly for the nested patch would
		// mean `{ enabled: false }` parses into a FULL object with
		// includeUntracked/chipRange re-injected as explicit defaults here at the
		// IPC boundary — before SettingsService.writeState()'s deep-merge ever
		// runs — silently discarding whatever it was meant to preserve.
		expect(
			WriteSettingsSchema.parse({
				patch: { usageTelemetry: { enabled: false } },
			}),
		).toEqual({ patch: { usageTelemetry: { enabled: false } } });
	});
});
