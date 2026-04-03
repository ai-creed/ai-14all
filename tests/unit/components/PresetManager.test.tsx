import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresetManager } from "../../../src/features/terminals/PresetManager";

describe("PresetManager", () => {
	it("creates and edits presets", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn();
		const onDelete = vi.fn();
		const onLaunch = vi.fn();

		render(
			<PresetManager
				open
				presets={[]}
				onOpenChange={() => {}}
				onSave={onSave}
				onDelete={onDelete}
				onLaunch={onLaunch}
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
});
