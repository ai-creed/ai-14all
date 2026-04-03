import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TerminalTabs } from "../../../src/features/terminals/TerminalTabs";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { CommandPreset } from "../../../shared/models/command-preset";

type ProcessTabView = Pick<
	ProcessSession,
	"id" | "label" | "status" | "pinned" | "attentionState"
>;

const stubHandlers = {
	onSelect: vi.fn(),
	onAddAdHoc: vi.fn(),
	onLaunchPreset: vi.fn(),
	onOpenPresetManager: vi.fn(),
	onClose: vi.fn(),
	onStop: vi.fn(),
	onRestart: vi.fn(),
	onTogglePinned: vi.fn(),
};

function renderTabs(
	processes: ProcessTabView[],
	activeProcessId: string | null = null,
	presets: CommandPreset[] = [],
	overrides: Partial<typeof stubHandlers> = {},
) {
	const handlers = { ...stubHandlers, ...overrides };
	// Reset all stubs before each render
	Object.values(stubHandlers).forEach((fn) => fn.mockClear());
	return render(
		<TerminalTabs
			processes={processes}
			activeProcessId={activeProcessId}
			presets={presets}
			{...handlers}
		/>,
	);
}

describe("TerminalTabs", () => {
	it("renders process labels and active state", () => {
		renderTabs(
			[
				{
					id: "proc-1",
					label: "shell 1",
					status: "running",
					pinned: false,
					attentionState: "idle",
				},
				{
					id: "proc-2",
					label: "shell 2",
					status: "running",
					pinned: false,
					attentionState: "idle",
				},
			],
			"proc-2",
		);

		expect(
			screen.getByRole("tablist", { name: "Terminal sessions" }),
		).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "shell 1" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "shell 2" })).toHaveAttribute(
			"data-state",
			"active",
		);
	});

	it("shows visual indicator and data-status for exited and errored tabs", () => {
		renderTabs(
			[
				{
					id: "proc-1",
					label: "shell 1",
					status: "running",
					pinned: false,
					attentionState: "idle",
				},
				{
					id: "proc-2",
					label: "shell 2",
					status: "exited",
					pinned: false,
					attentionState: "idle",
				},
				{
					id: "proc-3",
					label: "shell 3",
					status: "error",
					pinned: false,
					attentionState: "idle",
				},
			],
			"proc-1",
		);

		const tab1 = screen.getByRole("tab", { name: "shell 1" });
		const tab2 = screen.getByRole("tab", { name: "shell 2 (exited)" });
		const tab3 = screen.getByRole("tab", { name: "shell 3 (error)" });

		expect(tab1).toHaveTextContent("shell 1");
		expect(tab1).not.toHaveTextContent("(exited)");
		expect(tab1).toHaveAttribute("data-status", "running");

		expect(tab2).toHaveTextContent("shell 2 (exited)");
		expect(tab2).toHaveAttribute("data-status", "exited");

		expect(tab3).toHaveTextContent("shell 3 (error)");
		expect(tab3).toHaveAttribute("data-status", "error");
	});

	it("renders pinned and attention states for process tabs", () => {
		renderTabs(
			[
				{
					id: "proc-1",
					label: "shell 1",
					status: "running",
					pinned: true,
					attentionState: "activity",
				},
				{
					id: "proc-2",
					label: "shell 2",
					status: "running",
					pinned: false,
					attentionState: "actionRequired",
				},
			],
			"proc-1",
		);

		const tab1 = screen.getByRole("tab", { name: "shell 1" });
		const tab2 = screen.getByRole("tab", { name: "shell 2" });

		expect(tab1).toHaveAttribute("data-attention", "activity");
		expect(tab1).toHaveAttribute("data-pinned", "true");

		expect(tab2).toHaveAttribute("data-attention", "actionRequired");
		expect(tab2).toHaveAttribute("data-pinned", "false");
	});

	it("calls add, select, and close handlers", () => {
		const onAddAdHoc = vi.fn();
		const onSelect = vi.fn();
		const onClose = vi.fn();

		renderTabs(
			[
				{
					id: "proc-1",
					label: "shell 1",
					status: "running",
					pinned: false,
					attentionState: "idle",
				},
				{
					id: "proc-2",
					label: "shell 2",
					status: "running",
					pinned: false,
					attentionState: "idle",
				},
			],
			"proc-1",
			[],
			{ onAddAdHoc, onSelect, onClose },
		);

		fireEvent.click(screen.getByRole("button", { name: "+ Shell" }));
		fireEvent.click(screen.getByRole("tab", { name: "shell 2" }));
		fireEvent.click(screen.getByRole("button", { name: "Close shell 1" }));

		expect(onAddAdHoc).toHaveBeenCalled();
		expect(onSelect).toHaveBeenCalledWith("proc-2");
		expect(onClose).toHaveBeenCalledWith("proc-1");
	});

	it("supports keyboard tab switching", async () => {
		const onSelect = vi.fn();

		renderTabs(
			[
				{
					id: "proc-1",
					label: "shell 1",
					status: "running",
					pinned: false,
					attentionState: "idle",
				},
				{
					id: "proc-2",
					label: "shell 2",
					status: "running",
					pinned: false,
					attentionState: "idle",
				},
			],
			"proc-1",
			[],
			{ onSelect },
		);

		const firstTab = screen.getByRole("tab", { name: "shell 1" });
		firstTab.focus();
		fireEvent.keyDown(firstTab, { key: "ArrowRight" });

		await waitFor(() => {
			expect(onSelect).toHaveBeenCalledWith("proc-2");
		});
	});
});
