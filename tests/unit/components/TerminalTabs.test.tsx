import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TerminalTabs } from "../../../src/features/terminals/TerminalTabs";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { CommandPreset } from "../../../shared/models/command-preset";

type ProcessTabView = Pick<
	ProcessSession,
	| "id"
	| "label"
	| "status"
	| "pinned"
	| "attentionState"
	| "exitCode"
	| "lastActivityAt"
>;

function proc(
	overrides: Partial<ProcessTabView> & Pick<ProcessTabView, "id" | "label">,
): ProcessTabView {
	return {
		status: "running",
		pinned: false,
		attentionState: "idle",
		exitCode: null,
		lastActivityAt: null,
		...overrides,
	};
}

const stubHandlers = {
	onSelect: vi.fn(),
	onAddAdHoc: vi.fn(),
	onLaunchPreset: vi.fn(),
	onOpenPresetManager: vi.fn(),
	onClose: vi.fn(),
	onStop: vi.fn(),
	onRestart: vi.fn(),
	onTogglePinned: vi.fn(),
	onToggleSplitMode: vi.fn(),
	onShowInSplit: vi.fn(),
	onRemoveFromSplit: vi.fn(),
};

type RenderOptions = {
	layoutMode?: "single" | "split";
	splitLeftProcessId?: string | null;
	splitRightProcessId?: string | null;
};

function renderTabs(
	processes: ProcessTabView[],
	activeProcessId: string | null = null,
	presets: CommandPreset[] = [],
	overrides: Partial<typeof stubHandlers> = {},
	options: RenderOptions = {},
) {
	const handlers = { ...stubHandlers, ...overrides };
	// Reset all stubs before each render
	Object.values(stubHandlers).forEach((fn) => fn.mockClear());
	return render(
		<TerminalTabs
			processes={processes}
			activeProcessId={activeProcessId}
			presets={presets}
			layoutMode={options.layoutMode ?? "single"}
			splitLeftProcessId={options.splitLeftProcessId ?? null}
			splitRightProcessId={options.splitRightProcessId ?? null}
			{...handlers}
		/>,
	);
}

describe("TerminalTabs", () => {
	it("renders process labels and active state", () => {
		renderTabs(
			[
				proc({ id: "proc-1", label: "shell 1" }),
				proc({ id: "proc-2", label: "shell 2" }),
			],
			"proc-2",
		);

		expect(
			screen.getByRole("tablist", { name: "Terminal sessions" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("tablist", { name: "Terminal sessions" }),
		).toHaveClass("shell-terminal-tabs__list", "shell-terminal-tabs__segments");
		expect(screen.getByRole("button", { name: "Presets" })).toHaveClass(
			"shell-button",
			"shell-button--compact",
		);
		expect(screen.getByRole("button", { name: "Add shell" })).toHaveClass(
			"shell-button",
			"shell-button--icon",
			"shell-button--compact",
		);
		expect(
			document.querySelector(".shell-terminal-tabs__scroller"),
		).not.toBeNull();
		expect(screen.getByRole("tab", { name: "shell 1" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "shell 2" })).toHaveAttribute(
			"data-state",
			"active",
		);
	});

	it("renders split toggle state and calls layout toggle handler", async () => {
		const user = userEvent.setup();
		const onToggleSplitMode = vi.fn();

		renderTabs([proc({ id: "proc-1", label: "shell 1" })], "proc-1", [], {
			onToggleSplitMode,
		});

		const splitButton = screen.getByRole("button", {
			name: "Enable split shells",
		});
		expect(splitButton).toHaveAttribute("aria-pressed", "false");
		expect(splitButton).toHaveClass(
			"shell-button",
			"shell-button--icon",
			"shell-button--compact",
			"shell-button--round",
			"shell-terminal-tabs__split-toggle",
		);

		await user.click(splitButton);

		expect(onToggleSplitMode).toHaveBeenCalledTimes(1);
	});

	it("shows active styling on the split icon button when split mode is enabled", () => {
		renderTabs(
			[proc({ id: "proc-1", label: "shell 1" })],
			"proc-1",
			[],
			{},
			{ layoutMode: "split" },
		);

		const splitButton = screen.getByRole("button", {
			name: "Disable split shells",
		});
		expect(splitButton).toHaveAttribute("aria-pressed", "true");
		expect(splitButton).toHaveAttribute("data-active", "true");
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
					exitCode: null,
					lastActivityAt: null,
				},
				{
					id: "proc-2",
					label: "shell 2",
					status: "exited",
					pinned: false,
					attentionState: "idle",
					exitCode: null,
					lastActivityAt: null,
				},
				{
					id: "proc-3",
					label: "shell 3",
					status: "error",
					pinned: false,
					attentionState: "idle",
					exitCode: null,
					lastActivityAt: null,
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

	it("shows exit code in the status suffix for non-zero exits", () => {
		renderTabs(
			[
				{
					id: "proc-1",
					label: "shell 1",
					status: "exited",
					pinned: false,
					attentionState: "idle",
					exitCode: 0,
					lastActivityAt: null,
				},
				{
					id: "proc-2",
					label: "shell 2",
					status: "exited",
					pinned: false,
					attentionState: "idle",
					exitCode: 1,
					lastActivityAt: null,
				},
				{
					id: "proc-3",
					label: "shell 3",
					status: "error",
					pinned: false,
					attentionState: "idle",
					exitCode: 137,
					lastActivityAt: null,
				},
			],
			"proc-1",
		);

		expect(
			screen.getByRole("tab", { name: "shell 1 (exited)" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("tab", { name: "shell 2 (exited: 1)" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("tab", { name: "shell 3 (error: 137)" }),
		).toBeInTheDocument();
	});

	it("exposes last activity timestamp on the tab element", () => {
		const timestamp = Date.now() - 60_000;

		renderTabs(
			[
				{
					id: "proc-1",
					label: "shell 1",
					status: "running",
					pinned: false,
					attentionState: "idle",
					exitCode: null,
					lastActivityAt: timestamp,
				},
				{
					id: "proc-2",
					label: "shell 2",
					status: "running",
					pinned: false,
					attentionState: "idle",
					exitCode: null,
					lastActivityAt: null,
				},
			],
			"proc-1",
		);

		const tab1 = screen.getByRole("tab", { name: "shell 1" });
		const tab2 = screen.getByRole("tab", { name: "shell 2" });

		expect(tab1).toHaveAttribute("data-last-activity", String(timestamp));
		expect(tab2).not.toHaveAttribute("data-last-activity");
	});

	it("renders pinned and attention states for process tabs", () => {
		renderTabs(
			[
				proc({
					id: "proc-1",
					label: "shell 1",
					pinned: true,
					attentionState: "activity",
				}),
				proc({
					id: "proc-2",
					label: "shell 2",
					attentionState: "actionRequired",
				}),
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

	it("calls add, select, and close handlers", async () => {
		const user = userEvent.setup();
		const onAddAdHoc = vi.fn();
		const onSelect = vi.fn();
		const onClose = vi.fn();

		renderTabs(
			[
				proc({ id: "proc-1", label: "shell 1" }),
				proc({ id: "proc-2", label: "shell 2" }),
			],
			"proc-1",
			[],
			{ onAddAdHoc, onSelect, onClose },
		);

		fireEvent.click(screen.getByRole("button", { name: "Add shell" }));
		await user.click(screen.getByRole("tab", { name: "shell 2" }));
		await user.pointer([
			{
				target: screen.getByRole("tab", { name: "shell 1" }),
				keys: "[MouseRight]",
			},
		]);
		await user.click(screen.getByRole("menuitem", { name: "Close" }));

		expect(onAddAdHoc).toHaveBeenCalled();
		expect(onSelect).toHaveBeenCalledWith("proc-2");
		expect(onClose).toHaveBeenCalledWith("proc-1");
	});

	it("uses one preset menu for launching presets and opening the manager", async () => {
		const user = userEvent.setup();
		const onLaunchPreset = vi.fn();
		const onOpenPresetManager = vi.fn();

		renderTabs(
			[proc({ id: "proc-1", label: "shell 1" })],
			"proc-1",
			[{ id: "preset-1", label: "Claude", command: "claude" }],
			{ onLaunchPreset, onOpenPresetManager },
		);

		expect(
			screen.queryByRole("button", { name: "Manage presets" }),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Presets" }));
		await user.click(screen.getByRole("menuitem", { name: "Claude" }));
		expect(onLaunchPreset).toHaveBeenCalledWith("preset-1");

		await user.click(screen.getByRole("button", { name: "Presets" }));
		await user.click(screen.getByRole("menuitem", { name: "Manage presets" }));
		expect(onOpenPresetManager).toHaveBeenCalledTimes(1);
	});

	it("calls stop, restart, and toggle-pinned from the tab context menu", async () => {
		const user = userEvent.setup();
		const onStop = vi.fn();
		const onRestart = vi.fn();
		const onTogglePinned = vi.fn();

		renderTabs([proc({ id: "proc-1", label: "shell 1" })], "proc-1", [], {
			onStop,
			onRestart,
			onTogglePinned,
		});

		// Open the tab context menu and click Stop
		await user.pointer([
			{
				target: screen.getByRole("tab", { name: "shell 1" }),
				keys: "[MouseRight]",
			},
		]);
		await user.click(screen.getByRole("menuitem", { name: "Stop" }));
		expect(onStop).toHaveBeenCalledWith("proc-1");

		// Re-open and test restart
		await user.pointer([
			{
				target: screen.getByRole("tab", { name: "shell 1" }),
				keys: "[MouseRight]",
			},
		]);
		await user.click(screen.getByRole("menuitem", { name: "Restart" }));
		expect(onRestart).toHaveBeenCalledWith("proc-1");

		// Re-open and test pin toggle
		await user.pointer([
			{
				target: screen.getByRole("tab", { name: "shell 1" }),
				keys: "[MouseRight]",
			},
		]);
		await user.click(screen.getByRole("menuitem", { name: "Pin" }));
		expect(onTogglePinned).toHaveBeenCalledWith("proc-1");
	});

	it("shows split-slot actions in tab context menu", async () => {
		const user = userEvent.setup();
		const onShowInSplit = vi.fn();
		const onRemoveFromSplit = vi.fn();

		renderTabs(
			[proc({ id: "proc-1", label: "shell 1" })],
			"proc-1",
			[],
			{ onShowInSplit, onRemoveFromSplit },
			{ layoutMode: "split", splitLeftProcessId: "proc-1" },
		);

		await user.pointer([
			{
				target: screen.getByRole("tab", { name: "shell 1" }),
				keys: "[MouseRight]",
			},
		]);
		await user.click(
			screen.getByRole("menuitem", { name: "Show in split right" }),
		);
		expect(onShowInSplit).toHaveBeenCalledWith("proc-1", "right");

		await user.pointer([
			{
				target: screen.getByRole("tab", { name: "shell 1" }),
				keys: "[MouseRight]",
			},
		]);
		await user.click(
			screen.getByRole("menuitem", { name: "Remove from split" }),
		);
		expect(onRemoveFromSplit).toHaveBeenCalledWith("proc-1");
	});

	it("shows Unpin for already-pinned tabs", async () => {
		const user = userEvent.setup();

		renderTabs(
			[proc({ id: "proc-1", label: "Claude", pinned: true })],
			"proc-1",
		);

		await user.pointer([
			{
				target: screen.getByRole("tab", { name: "Claude" }),
				keys: "[MouseRight]",
			},
		]);

		expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeInTheDocument();
	});

	it("opens the process actions menu on right click of a terminal tab", async () => {
		const user = userEvent.setup();
		renderTabs([proc({ id: "proc-1", label: "shell 1" })], "proc-1");

		await user.pointer([
			{
				target: screen.getByRole("tab", { name: "shell 1" }),
				keys: "[MouseRight]",
			},
		]);

		expect(screen.getByRole("menuitem", { name: "Pin" })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Actions for shell 1" }),
		).not.toBeInTheDocument();
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
					exitCode: null,
					lastActivityAt: null,
				},
				{
					id: "proc-2",
					label: "shell 2",
					status: "running",
					pinned: false,
					attentionState: "idle",
					exitCode: null,
					lastActivityAt: null,
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
