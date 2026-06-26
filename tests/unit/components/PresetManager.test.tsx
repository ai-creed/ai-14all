import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresetManager } from "../../../src/features/terminals/components/PresetManager";

describe("PresetManager", () => {
	it("creates a new preset", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn();

		render(
			<PresetManager
				open
				presets={[]}
				onOpenChange={() => {}}
				onSave={onSave}
				onDelete={vi.fn()}
				onLaunch={vi.fn()}
			/>,
		);

		await user.type(screen.getByLabelText("Preset label"), "Claude");
		await user.type(screen.getByLabelText("Preset command"), "claude");
		await user.click(screen.getByRole("button", { name: "Save preset" }));

		expect(onSave).toHaveBeenCalledWith({
			id: expect.any(String),
			label: "Claude",
			command: "claude",
		});
	});

	it("edits an existing preset", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn();
		const existing = {
			id: "preset-1",
			label: "Claude",
			command: "claude",
			target: "pinned" as const,
		};

		render(
			<PresetManager
				open
				presets={[existing]}
				onOpenChange={() => {}}
				onSave={onSave}
				onDelete={vi.fn()}
				onLaunch={vi.fn()}
			/>,
		);

		// Click the Edit button to load preset into the form
		await user.click(screen.getByRole("button", { name: "Edit" }));

		// Form should be populated with existing values
		expect(screen.getByLabelText("Preset label")).toHaveValue("Claude");
		expect(screen.getByLabelText("Preset command")).toHaveValue("claude");

		// Change the command and save
		await user.clear(screen.getByLabelText("Preset command"));
		await user.type(
			screen.getByLabelText("Preset command"),
			"claude --model opus",
		);
		await user.click(screen.getByRole("button", { name: "Save preset" }));

		// Should save with the same id, not a new one
		expect(onSave).toHaveBeenCalledWith({
			id: "preset-1",
			label: "Claude",
			command: "claude --model opus",
		});
	});
});
