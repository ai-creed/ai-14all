import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TerminalPanel } from "../../../src/app/components/TerminalPanel";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../shared/models/persisted-settings";

vi.mock("../../../src/features/terminals/components/TerminalPane", () => ({
	TerminalPane: () => <div data-testid="terminal-pane-stub" />,
}));

const settingsFixture = {
	settings: {
		...DEFAULT_PERSISTED_SETTINGS,
		terminalConfirm: { restart: true, close: true },
	},
	update: vi.fn(),
};
vi.mock("../../../src/app/hooks/use-settings", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useSettings: () => settingsFixture,
}));

beforeEach(() => {
	settingsFixture.settings.terminalConfirm = { restart: true, close: true };
	settingsFixture.update.mockReset();
});

function proc(id: string) {
	return {
		id,
		workspaceId: "ws1",
		worktreeId: "wt1",
		terminalSessionId: `t-${id}`,
		origin: "adHoc",
		presetId: null,
		label: id,
		command: null,
		status: "running",
		lastActivityAt: null,
		lastOutputPreview: null,
		exitCode: null,
		pinned: false,
		attentionState: "idle",
		agentAttentionReasons: {},
		agentAttentionClearedAt: null,
		agentDetected: false,
		provider: null,
	};
}
function termSession(id: string) {
	return { id: `t-${id}`, worktreeId: "wt1", status: "running" } as never;
}
function baseProps(layoutId: string, slots: (string | null)[]) {
	const present = slots.filter((s): s is string => s !== null);
	return {
		terminalTheme: {},
		workspaceState: {
			selectedWorktreeId: "wt1",
			processSessionsById: Object.fromEntries(
				present.map((id) => [id, proc(id)]),
			),
		} as never,
		activeWorktree: { id: "wt1", path: "/wt1" } as never,
		activeSession: { activeProcessSessionId: present[0] ?? null } as never,
		sessions: present.map((id) => termSession(id)),
		layoutId: layoutId as never,
		slotProcessIds: slots,
		terminalFocusSignal: 0,
		dispatch: vi.fn(),
		selectActiveProcess: vi.fn(),
		onCloseSlot: vi.fn(),
		onRestartSlot: vi.fn(),
		onPromoteSlot: vi.fn(),
		onStartShellInSlot: vi.fn(),
		agentProviders: [],
		onLaunchAgentInSlot: vi.fn(),
		findProcessByTerminalSessionId: () => null,
	};
}

describe("TerminalPanel", () => {
	it("renders an empty-slot CTA for null slots", () => {
		render(<TerminalPanel {...baseProps("3-vm", ["m", "c1", null])} />);
		expect(screen.getByTestId("slot-cta-2")).toBeInTheDocument();
		expect(screen.queryByTestId("slot-cta-0")).not.toBeInTheDocument();
	});
	it("surfaces agent chips in empty slots when providers are detected", () => {
		render(
			<TerminalPanel
				{...baseProps("3-vm", ["m", "c1", null])}
				agentProviders={["claude", "codex"]}
			/>,
		);
		expect(screen.getByTestId("slot-agent-2-claude")).toBeInTheDocument();
		expect(screen.getByTestId("slot-agent-2-codex")).toBeInTheDocument();
		// Occupied slots get no launcher.
		expect(screen.queryByTestId("slot-agent-0-claude")).not.toBeInTheDocument();
	});
	it("shows the promote action only on CHILD slots in a master family", () => {
		render(<TerminalPanel {...baseProps("3-vm", ["m", "c1", "c2"])} />);
		expect(screen.queryByTestId("slot-promote-0")).not.toBeInTheDocument();
		expect(screen.getByTestId("slot-promote-1")).toBeInTheDocument();
		expect(screen.getByTestId("slot-promote-2")).toBeInTheDocument();
	});
	it("shows no promote action in an equal family", () => {
		render(<TerminalPanel {...baseProps("3-v", ["a", "b", "c"])} />);
		expect(screen.queryByTestId("slot-promote-0")).not.toBeInTheDocument();
		expect(screen.queryByTestId("slot-promote-1")).not.toBeInTheDocument();
	});
	it("renders an attention/status badge for each occupied slot", () => {
		render(<TerminalPanel {...baseProps("2-v", ["a", "b"])} />);
		expect(screen.getByTestId("slot-badge-0")).toHaveAttribute(
			"data-status",
			"running",
		);
		expect(screen.getByTestId("slot-badge-1")).toBeInTheDocument();
	});
});

describe("TerminalPanel confirm gate", () => {
	it("restart on a running shell opens the dialog; confirm invokes onRestartSlot, cancel does not", () => {
		const props = baseProps("1", ["p1"]);
		render(<TerminalPanel {...props} />);
		fireEvent.click(screen.getByTestId("slot-restart-0"));
		expect(props.onRestartSlot).not.toHaveBeenCalled();
		expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
		expect(props.onRestartSlot).not.toHaveBeenCalled();
		fireEvent.click(screen.getByTestId("slot-restart-0"));
		fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
		expect(props.onRestartSlot).toHaveBeenCalledWith("p1");
	});

	it("the confirm button holds initial focus and Escape cancels", async () => {
		const props = baseProps("1", ["p1"]);
		render(<TerminalPanel {...props} />);
		fireEvent.click(screen.getByTestId("slot-close-0"));
		await waitFor(() =>
			expect(screen.getByTestId("confirm-dialog-confirm")).toHaveFocus(),
		);
		fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
		await waitFor(() =>
			expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument(),
		);
		expect(props.onCloseSlot).not.toHaveBeenCalled();
	});

	it("scrim click cancels", async () => {
		const props = baseProps("1", ["p1"]);
		render(<TerminalPanel {...props} />);
		fireEvent.click(screen.getByTestId("slot-close-0"));
		await screen.findByTestId("confirm-dialog");
		// Radix DismissableLayer listens for pointerdown outside the content;
		// body is outside → outside-interaction dismiss = scrim cancel.
		fireEvent.pointerDown(document.body);
		await waitFor(() =>
			expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument(),
		);
		expect(props.onCloseSlot).not.toHaveBeenCalled();
	});

	it.each(["exited", "error", "restarting"] as const)(
		"status %s bypasses the dialog",
		(status) => {
			const props = baseProps("1", ["p1"]);
			(
				props.workspaceState as {
					processSessionsById: Record<string, { status: string }>;
				}
			).processSessionsById.p1.status = status;
			render(<TerminalPanel {...props} />);
			fireEvent.click(screen.getByTestId("slot-close-0"));
			expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
			expect(props.onCloseSlot).toHaveBeenCalledWith("p1");
		},
	);

	it("close pref silent bypasses close while restart STILL asks (per-action, spec §5.2)", () => {
		settingsFixture.settings.terminalConfirm = { restart: true, close: false };
		const props = baseProps("1", ["p1"]);
		render(<TerminalPanel {...props} />);
		fireEvent.click(screen.getByTestId("slot-close-0"));
		expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
		expect(props.onCloseSlot).toHaveBeenCalledWith("p1");
		// The OTHER action's preference is untouched: restart must still ask.
		fireEvent.click(screen.getByTestId("slot-restart-0"));
		expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
		expect(props.onRestartSlot).not.toHaveBeenCalled();
	});

	it("restart pref silent bypasses restart while close STILL asks (per-action, spec §5.2)", () => {
		settingsFixture.settings.terminalConfirm = { restart: false, close: true };
		const props = baseProps("1", ["p1"]);
		render(<TerminalPanel {...props} />);
		fireEvent.click(screen.getByTestId("slot-restart-0"));
		expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
		expect(props.onRestartSlot).toHaveBeenCalledWith("p1");
		// A regression reading the close pref for both actions fails here:
		fireEvent.click(screen.getByTestId("slot-close-0"));
		expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
		expect(props.onCloseSlot).not.toHaveBeenCalled();
	});

	it("don't-ask-again writes the bare per-action patch", () => {
		const props = baseProps("1", ["p1"]);
		render(<TerminalPanel {...props} />);
		fireEvent.click(screen.getByTestId("slot-restart-0"));
		fireEvent.click(screen.getByTestId("confirm-dialog-dontask"));
		fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
		expect(settingsFixture.update).toHaveBeenCalledWith({
			terminalConfirm: { restart: false },
		});
		expect(props.onRestartSlot).toHaveBeenCalledWith("p1");
	});

	it("a second click while open retargets the single dialog", () => {
		const props = baseProps("2-v", ["p1", "p2"]);
		render(<TerminalPanel {...props} />);
		fireEvent.click(screen.getByTestId("slot-restart-0"));
		expect(screen.getByText("Restart shell?")).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("slot-close-1"));
		expect(screen.getAllByTestId("confirm-dialog")).toHaveLength(1);
		expect(screen.getByText("Close shell?")).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
		expect(props.onCloseSlot).toHaveBeenCalledWith("p2");
		expect(props.onRestartSlot).not.toHaveBeenCalled();
	});
});
