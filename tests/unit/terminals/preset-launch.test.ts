import { describe, it, expect } from "vitest";
import { resolvePresetLaunch } from "../../../src/features/terminals/logic/preset-launch";
import type { CommandPreset } from "../../../shared/models/command-preset";

const base: CommandPreset = {
	id: "p1",
	label: "deploy",
	command: "make deploy",
	target: "pinned",
};

describe("resolvePresetLaunch", () => {
	it("routes a pinned preset to the pinned grid path", () => {
		expect(resolvePresetLaunch(base)).toEqual({ kind: "pinned" });
	});

	it("routes a throwaway preset to the floating-shell path with command + label", () => {
		const p: CommandPreset = { ...base, target: "throwaway" };
		expect(resolvePresetLaunch(p)).toEqual({
			kind: "throwaway",
			command: "make deploy",
			label: "deploy",
		});
	});
});
