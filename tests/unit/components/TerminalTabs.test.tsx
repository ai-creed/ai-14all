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
				proc({ id: "proc-1", label: "shell 1" }),
				proc({ id: "proc-2", label: "shell 2" }),
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

		fireEvent.click(screen.getByRole("button", { name: "+ Shell" }));
		fireEvent.click(screen.getByRole("tab", { name: "shell 2" }));
		await user.click(
			screen.getByRole("button", { name: "Actions for shell 1" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Close" }));

		expect(onAddAdHoc).toHaveBeenCalled();
		expect(onSelect).toHaveBeenCalledWith("proc-2");
		expect(onClose).toHaveBeenCalledWith("proc-1");
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
		await user.click(
			screen.getByRole("button", { name: "Actions for shell 1" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Stop" }));
		expect(onStop).toHaveBeenCalledWith("proc-1");

		// Re-open and test restart
		await user.click(
			screen.getByRole("button", { name: "Actions for shell 1" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Restart" }));
		expect(onRestart).toHaveBeenCalledWith("proc-1");

		// Re-open and test pin toggle
		await user.click(
			screen.getByRole("button", { name: "Actions for shell 1" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Pin" }));
		expect(onTogglePinned).toHaveBeenCalledWith("proc-1");
	});

	it("shows Unpin for already-pinned tabs", async () => {
		const user = userEvent.setup();

		renderTabs(
			[proc({ id: "proc-1", label: "Claude", pinned: true })],
			"proc-1",
		);

		await user.click(
			screen.getByRole("button", { name: "Actions for Claude" }),
		);

		expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeInTheDocument();
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
