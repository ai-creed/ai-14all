import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TerminalToolbar } from "../../../src/features/terminals/components/TerminalToolbar";

function props(
	over: Partial<Parameters<typeof TerminalToolbar>[0]> = {},
): Parameters<typeof TerminalToolbar>[0] {
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

describe("TerminalToolbar add control", () => {
	it("is enabled below 6 running shells (addDisabled=false)", () => {
		render(<TerminalToolbar {...props({ addDisabled: false })} />);
		expect(screen.getByTestId("terminal-add-shell")).not.toBeDisabled();
	});
	it("is disabled at 6 running shells (addDisabled=true)", () => {
		render(<TerminalToolbar {...props({ addDisabled: true })} />);
		expect(screen.getByTestId("terminal-add-shell")).toBeDisabled();
	});
	it("does not call onAddAdHoc when disabled and clicked", async () => {
		const onAddAdHoc = vi.fn();
		const user = userEvent.setup();
		render(<TerminalToolbar {...props({ addDisabled: true, onAddAdHoc })} />);
		await user.click(screen.getByTestId("terminal-add-shell")).catch(() => {});
		expect(onAddAdHoc).not.toHaveBeenCalled();
	});
	it("opens the layout dialog when the layout button is clicked", async () => {
		const onOpenLayoutDialog = vi.fn();
		const user = userEvent.setup();
		render(<TerminalToolbar {...props({ onOpenLayoutDialog })} />);
		await user.click(screen.getByTestId("terminal-layout-button"));
		expect(onOpenLayoutDialog).toHaveBeenCalledTimes(1);
	});
});
