import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutsHelp } from "../../../../src/features/shortcuts/ShortcutsHelp";
import { SHORTCUT_REGISTRY } from "../../../../src/app/shortcut-registry";

describe("ShortcutsHelp", () => {
	it("renders nothing when open=false", () => {
		render(<ShortcutsHelp open={false} platform="mac" onClose={() => {}} />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("renders the dialog when open=true", () => {
		render(<ShortcutsHelp open platform="mac" onClose={() => {}} />);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});

	it("has accessible name 'Keyboard shortcuts'", () => {
		render(<ShortcutsHelp open platform="mac" onClose={() => {}} />);
		expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
	});

	it("renders a row for every registry entry", () => {
		render(<ShortcutsHelp open platform="mac" onClose={() => {}} />);
		for (const s of SHORTCUT_REGISTRY) {
			expect(screen.getByTestId(`shortcuts-help-row-${s.id}`)).toBeInTheDocument();
		}
	});

	it("shows each shortcut label", () => {
		render(<ShortcutsHelp open platform="mac" onClose={() => {}} />);
		for (const s of SHORTCUT_REGISTRY) {
			expect(screen.getByTestId(`shortcuts-help-row-${s.id}`)).toHaveTextContent(s.label);
		}
	});

	it("shows mac display keys when platform='mac'", () => {
		render(<ShortcutsHelp open platform="mac" onClose={() => {}} />);
		for (const s of SHORTCUT_REGISTRY) {
			expect(screen.getByTestId(`shortcuts-help-row-${s.id}`)).toHaveTextContent(s.mac);
		}
	});

	it("shows other display keys when platform='other'", () => {
		render(<ShortcutsHelp open platform="other" onClose={() => {}} />);
		for (const s of SHORTCUT_REGISTRY) {
			expect(screen.getByTestId(`shortcuts-help-row-${s.id}`)).toHaveTextContent(s.other);
		}
	});

	it("calls onClose when Escape is pressed", async () => {
		const user = userEvent.setup();
		const spy = vi.fn();
		render(<ShortcutsHelp open platform="mac" onClose={spy} />);
		await user.keyboard("{Escape}");
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("renders a close button", () => {
		render(<ShortcutsHelp open platform="mac" onClose={() => {}} />);
		expect(screen.getByRole("button", { name: /close shortcuts/i })).toBeInTheDocument();
	});

	it("calls onClose when close button is clicked", async () => {
		const onClose = vi.fn();
		render(<ShortcutsHelp open={true} platform="mac" onClose={onClose} />);
		await userEvent.click(screen.getByTestId("shortcuts-help-close"));
		expect(onClose).toHaveBeenCalledOnce();
	});
});
