import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PresetManager } from "../../../src/features/terminals/components/PresetManager";

function Wrapper({ children }: { children: React.ReactNode }) {
	return <TooltipProvider>{children}</TooltipProvider>;
}

describe("PresetManager", () => {
	it("creates a new preset with default pinned target", async () => {
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
			{ wrapper: Wrapper },
		);

		await user.type(screen.getByLabelText("Preset label"), "Claude");
		await user.type(screen.getByLabelText("Preset command"), "claude");
		await user.click(screen.getByRole("button", { name: "Save preset" }));

		expect(onSave).toHaveBeenCalledWith({
			id: expect.any(String),
			label: "Claude",
			command: "claude",
			target: "pinned",
		});
	});

	it("creates a new preset with throwaway target when toggled", async () => {
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
			{ wrapper: Wrapper },
		);

		await user.type(screen.getByLabelText("Preset label"), "Tw");
		await user.type(screen.getByLabelText("Preset command"), "echo tw");
		await user.click(screen.getByTestId("preset-target-throwaway"));
		await user.click(screen.getByRole("button", { name: "Save preset" }));

		expect(onSave).toHaveBeenCalledWith({
			id: expect.any(String),
			label: "Tw",
			command: "echo tw",
			target: "throwaway",
		});
	});

	it("resets target to pinned after save", async () => {
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
			{ wrapper: Wrapper },
		);

		await user.type(screen.getByLabelText("Preset label"), "Tw");
		await user.type(screen.getByLabelText("Preset command"), "echo tw");
		await user.click(screen.getByTestId("preset-target-throwaway"));
		await user.click(screen.getByRole("button", { name: "Save preset" }));

		// After save, the pinned toggle should be active again
		expect(screen.getByTestId("preset-target-pinned")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByTestId("preset-target-throwaway")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("edits an existing preset using icon button with accessible name", async () => {
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
			{ wrapper: Wrapper },
		);

		// Click the icon-only Edit button by its accessible name (aria-label)
		await user.click(screen.getByRole("button", { name: "Edit preset" }));

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
			target: "pinned",
		});
	});

	it("renders icon-only action buttons with accessible names", () => {
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
				onSave={vi.fn()}
				onDelete={vi.fn()}
				onLaunch={vi.fn()}
			/>,
			{ wrapper: Wrapper },
		);

		expect(
			screen.getByRole("button", { name: "Edit preset" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Delete preset" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Launch in pinned terminal" }),
		).toBeInTheDocument();
	});

	it("shows 'Launch in throwaway shell' label for throwaway-target preset", () => {
		const existing = {
			id: "preset-tw",
			label: "Tw",
			command: "echo tw",
			target: "throwaway" as const,
		};

		render(
			<PresetManager
				open
				presets={[existing]}
				onOpenChange={() => {}}
				onSave={vi.fn()}
				onDelete={vi.fn()}
				onLaunch={vi.fn()}
			/>,
			{ wrapper: Wrapper },
		);

		expect(
			screen.getByRole("button", { name: "Launch in throwaway shell" }),
		).toBeInTheDocument();
	});

	it("calls onDelete with preset id when Delete button is clicked", async () => {
		const user = userEvent.setup();
		const onDelete = vi.fn();
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
				onSave={vi.fn()}
				onDelete={onDelete}
				onLaunch={vi.fn()}
			/>,
			{ wrapper: Wrapper },
		);

		await user.click(screen.getByRole("button", { name: "Delete preset" }));
		expect(onDelete).toHaveBeenCalledWith("preset-1");
	});

	it("calls onLaunch with preset id when Launch button is clicked", async () => {
		const user = userEvent.setup();
		const onLaunch = vi.fn();
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
				onSave={vi.fn()}
				onDelete={vi.fn()}
				onLaunch={onLaunch}
			/>,
			{ wrapper: Wrapper },
		);

		await user.click(
			screen.getByRole("button", { name: "Launch in pinned terminal" }),
		);
		expect(onLaunch).toHaveBeenCalledWith("preset-1");
	});

	it("renders preset command in a code element", () => {
		const existing = {
			id: "preset-1",
			label: "Claude",
			command: "claude --dangerously-skip-permissions",
			target: "pinned" as const,
		};

		render(
			<PresetManager
				open
				presets={[existing]}
				onOpenChange={() => {}}
				onSave={vi.fn()}
				onDelete={vi.fn()}
				onLaunch={vi.fn()}
			/>,
			{ wrapper: Wrapper },
		);

		const codeEl = screen.getByText("claude --dangerously-skip-permissions");
		expect(codeEl.tagName.toLowerCase()).toBe("code");
	});
});
