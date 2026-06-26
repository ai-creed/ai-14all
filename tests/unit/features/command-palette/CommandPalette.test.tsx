import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "../../../../src/features/command-palette/components/CommandPalette";
import { CommandRegistryProvider } from "../../../../src/features/command-palette/components/CommandRegistryProvider";
import { useRegisterCommands } from "../../../../src/features/command-palette/hooks/use-command-registry";
import type { Command } from "../../../../src/features/command-palette/logic/command";

function Harness({
	commands,
	onOpenChange = () => {},
}: {
	commands: Command[];
	onOpenChange?: (open: boolean) => void;
}) {
	useRegisterCommands(commands, []);
	return <CommandPalette open onOpenChange={onOpenChange} platform="mac" />;
}

const renderPalette = (commands: Command[], onOpenChange?: (o: boolean) => void) =>
	render(
		<CommandRegistryProvider>
			<Harness commands={commands} onOpenChange={onOpenChange} />
		</CommandRegistryProvider>,
	);

describe("CommandPalette", () => {
	it("lists available commands and hides unavailable ones", () => {
		renderPalette([
			{ id: "a", title: "New terminal", group: "Terminal", run: () => {} },
			{
				id: "b",
				title: "Close terminal",
				group: "Terminal",
				run: () => {},
				isAvailable: () => false,
			},
		]);
		expect(screen.getByText("New terminal")).toBeInTheDocument();
		expect(screen.queryByText("Close terminal")).not.toBeInTheDocument();
	});

	it("filters rows by the typed query", async () => {
		const user = userEvent.setup();
		renderPalette([
			{ id: "a", title: "New terminal", group: "Terminal", run: () => {} },
			{ id: "b", title: "Open Review", group: "Review", run: () => {} },
		]);
		await user.type(screen.getByTestId("command-palette-search"), "review");
		expect(screen.getByText("Open Review")).toBeInTheDocument();
		expect(screen.queryByText("New terminal")).not.toBeInTheDocument();
	});

	it("runs the selected command and closes on Enter", async () => {
		const user = userEvent.setup();
		const run = vi.fn();
		const onOpenChange = vi.fn();
		renderPalette(
			[{ id: "a", title: "New terminal", group: "Terminal", run }],
			onOpenChange,
		);
		await user.keyboard("{Enter}");
		expect(run).toHaveBeenCalledTimes(1);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("moves the selection with ArrowDown before running", async () => {
		const user = userEvent.setup();
		const first = vi.fn();
		const second = vi.fn();
		renderPalette([
			{ id: "a", title: "Aaa", group: "G", run: first },
			{ id: "b", title: "Bbb", group: "G", run: second },
		]);
		await user.keyboard("{ArrowDown}{Enter}");
		expect(second).toHaveBeenCalledTimes(1);
		expect(first).not.toHaveBeenCalled();
	});

	it("shows an empty state when nothing matches", async () => {
		const user = userEvent.setup();
		renderPalette([
			{ id: "a", title: "New terminal", group: "Terminal", run: () => {} },
		]);
		await user.type(screen.getByTestId("command-palette-search"), "zzzzz");
		expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
	});

	it("renders a keybinding hint for keybound commands and none for palette-only", () => {
		renderPalette([
			{
				id: "term",
				title: "New terminal",
				group: "Terminal",
				keybindingId: "terminal.new",
				run: () => {},
			},
			{ id: "plug", title: "Open Plugins", group: "App", run: () => {} },
		]);
		// "terminal.new" → "⌘T" on mac (from SHORTCUT_REGISTRY)
		expect(screen.getByText("⌘T")).toBeInTheDocument();
		expect(
			screen.getByTestId("command-palette-row-plug").querySelector("kbd"),
		).toBeNull();
	});

	it("closes on Escape", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		renderPalette(
			[{ id: "a", title: "New terminal", group: "Terminal", run: () => {} }],
			onOpenChange,
		);
		await user.keyboard("{Escape}");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("scrolls the selected row into view on keyboard navigation", async () => {
		const user = userEvent.setup();
		const scrollSpy = vi.fn();
		const original = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = scrollSpy;
		try {
			renderPalette([
				{ id: "a", title: "Aaa", group: "G", run: () => {} },
				{ id: "b", title: "Bbb", group: "G", run: () => {} },
			]);
			scrollSpy.mockClear(); // ignore the initial mount/selection scroll
			await user.keyboard("{ArrowDown}");
			expect(scrollSpy).toHaveBeenCalled();
		} finally {
			Element.prototype.scrollIntoView = original;
		}
	});
});
