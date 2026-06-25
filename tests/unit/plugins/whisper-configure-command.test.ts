import { describe, expect, it } from "vitest";
import { whisperConfigureCommand } from "../../../src/features/plugins/components/PluginsPanelDialog";

describe("whisperConfigureCommand", () => {
	it("installs the bundled agent skills with --force so re-clicking is safe", () => {
		// Per the ai-whisper README Quickstart, `whisper skill install` installs the
		// bundled workflow skills. `--force` overwrites in place instead of erroring
		// when a skill directory already exists, so the Configure button is
		// idempotent across repeated clicks.
		expect(whisperConfigureCommand()).toBe("whisper skill install --force");
	});
});
