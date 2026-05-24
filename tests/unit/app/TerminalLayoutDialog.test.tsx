import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TerminalLayoutDialog } from "../../../src/features/terminals/components/TerminalLayoutDialog";

describe("TerminalLayoutDialog", () => {
	it("renders a tile for every layout id", () => {
		render(
			<TerminalLayoutDialog
				open
				runningShells={1}
				currentLayoutId="1"
				onSelect={() => {}}
				onClose={() => {}}
			/>,
		);
		expect(screen.getAllByTestId(/^layout-tile-/)).toHaveLength(26);
	});

	it("disables layouts whose slot count is below the running shell count", () => {
		render(
			<TerminalLayoutDialog
				open
				runningShells={3}
				currentLayoutId="3-v"
				onSelect={() => {}}
				onClose={() => {}}
			/>,
		);
		expect(screen.getByTestId("layout-tile-2-v")).toBeDisabled();
		expect(screen.getByTestId("layout-tile-4-grid")).not.toBeDisabled();
	});

	it("calls onSelect with the layout id for an enabled tile", async () => {
		const onSelect = vi.fn();
		const user = userEvent.setup();
		render(
			<TerminalLayoutDialog
				open
				runningShells={1}
				currentLayoutId="1"
				onSelect={onSelect}
				onClose={() => {}}
			/>,
		);
		await user.click(screen.getByTestId("layout-tile-3-vm"));
		expect(onSelect).toHaveBeenCalledWith("3-vm");
	});
});
