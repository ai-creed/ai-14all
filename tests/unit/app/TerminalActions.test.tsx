import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TerminalActions } from "../../../src/features/terminals/components/TerminalActions";

function props(
	over: Partial<Parameters<typeof TerminalActions>[0]> = {},
): Parameters<typeof TerminalActions>[0] {
	return {
		presets: [],
		addDisabled: false,
		onAddAdHoc: vi.fn(),
		onLaunchPreset: vi.fn(),
		onOpenPresetManager: vi.fn(),
		onOpenLayoutDialog: vi.fn(),
		...over,
	};
}

describe("TerminalActions add control", () => {
	it("is enabled below 6 running shells (addDisabled=false)", () => {
		render(<TerminalActions {...props({ addDisabled: false })} />);
		expect(screen.getByTestId("terminal-add-shell")).not.toBeDisabled();
	});
	it("is disabled at 6 running shells (addDisabled=true)", () => {
		render(<TerminalActions {...props({ addDisabled: true })} />);
		expect(screen.getByTestId("terminal-add-shell")).toBeDisabled();
	});
	it("does not call onAddAdHoc when disabled and clicked", async () => {
		const onAddAdHoc = vi.fn();
		const user = userEvent.setup();
		render(<TerminalActions {...props({ addDisabled: true, onAddAdHoc })} />);
		await user.click(screen.getByTestId("terminal-add-shell")).catch(() => {});
		expect(onAddAdHoc).not.toHaveBeenCalled();
	});
	it("opens the layout dialog when the layout button is clicked", async () => {
		const onOpenLayoutDialog = vi.fn();
		const user = userEvent.setup();
		render(<TerminalActions {...props({ onOpenLayoutDialog })} />);
		await user.click(screen.getByTestId("terminal-layout-button"));
		expect(onOpenLayoutDialog).toHaveBeenCalledTimes(1);
	});
});

describe("TerminalActions presets menu", () => {
	it("lists presets and launches the chosen one", async () => {
		const onLaunchPreset = vi.fn();
		const user = userEvent.setup();
		render(
			<TerminalActions
				{...props({
					presets: [
						{ id: "p1", label: "Dev server", command: "npm run dev" },
						{ id: "p2", label: "Tests", command: "npm test" },
					],
					onLaunchPreset,
				})}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /presets/i }));
		await user.click(
			await screen.findByRole("menuitem", { name: "Dev server" }),
		);
		expect(onLaunchPreset).toHaveBeenCalledWith("p1");
	});

	it("opens the preset manager from the menu", async () => {
		const onOpenPresetManager = vi.fn();
		const user = userEvent.setup();
		render(<TerminalActions {...props({ onOpenPresetManager })} />);
		await user.click(screen.getByRole("button", { name: /presets/i }));
		await user.click(
			await screen.findByRole("menuitem", { name: /manage presets/i }),
		);
		expect(onOpenPresetManager).toHaveBeenCalledTimes(1);
	});
});
