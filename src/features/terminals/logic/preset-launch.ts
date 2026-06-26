import type { CommandPreset } from "../../../../shared/models/command-preset";

export type PresetLaunchPlan =
	| { kind: "pinned" }
	| { kind: "throwaway"; command: string; label: string };

/**
 * Decide where a preset's Launch should send the command: a pinned grid terminal
 * (the default) or a throwaway floating shell. Pure so the routing decision is
 * unit-testable; App.tsx dispatches the matching side-effecting call.
 */
export function resolvePresetLaunch(preset: CommandPreset): PresetLaunchPlan {
	if (preset.target === "throwaway") {
		return { kind: "throwaway", command: preset.command, label: preset.label };
	}
	return { kind: "pinned" };
}
