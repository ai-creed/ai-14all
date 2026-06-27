import { describe, it, expect } from "vitest";
import {
	DEFAULT_COMMAND_PRESETS,
	pruneRetiredDefaults,
	type CommandPreset,
} from "../../../shared/models/command-preset";

describe("DEFAULT_COMMAND_PRESETS", () => {
	it("keeps only the two yolo presets, each targeting a pinned terminal", () => {
		expect(DEFAULT_COMMAND_PRESETS.map((p) => p.id)).toEqual([
			"preset-start-claude-yolo",
			"preset-start-codex-yolo",
		]);
		for (const p of DEFAULT_COMMAND_PRESETS) expect(p.target).toBe("pinned");
	});
});

describe("pruneRetiredDefaults", () => {
	const retiredClaude: CommandPreset = {
		id: "preset-start-claude",
		label: "start claude",
		command: "claude",
		target: "pinned",
	};
	const retiredCodex: CommandPreset = {
		id: "preset-start-codex",
		label: "start codex",
		command: "codex",
		target: "pinned",
	};

	it("removes untouched retired defaults", () => {
		const result = pruneRetiredDefaults([retiredClaude, retiredCodex]);
		expect(result).toEqual([]);
	});

	it("keeps a retired-id preset whose command was edited by the user", () => {
		const edited: CommandPreset = {
			...retiredClaude,
			command: "claude --resume",
		};
		expect(pruneRetiredDefaults([edited])).toEqual([edited]);
	});

	it("keeps the yolo defaults and unrelated user presets", () => {
		const mine: CommandPreset = {
			id: "abc",
			label: "deploy",
			command: "make deploy",
			target: "throwaway",
		};
		const input = [...DEFAULT_COMMAND_PRESETS, retiredClaude, mine];
		const result = pruneRetiredDefaults(input);
		expect(result).toEqual([...DEFAULT_COMMAND_PRESETS, mine]);
	});
});
