import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TerminalPanel } from "../../../src/app/components/TerminalPanel";

vi.mock("../../../src/features/terminals/components/TerminalPane", () => ({
	TerminalPane: () => <div data-testid="terminal-pane-stub" />,
}));

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
		findProcessByTerminalSessionId: () => null,
	};
}

describe("TerminalPanel", () => {
	it("renders an empty-slot CTA for null slots", () => {
		render(<TerminalPanel {...baseProps("3-vm", ["m", "c1", null])} />);
		expect(screen.getByTestId("slot-cta-2")).toBeInTheDocument();
		expect(screen.queryByTestId("slot-cta-0")).not.toBeInTheDocument();
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
