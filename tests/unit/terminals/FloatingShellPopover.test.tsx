import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloatingShellPopover } from "../../../src/features/terminals/components/FloatingShellPopover";
import type { ProcessSession } from "../../../shared/models/process-session";

vi.mock(
	"../../../src/features/terminals/components/TerminalPane",
	() => ({ TerminalPane: () => <div data-testid="terminal-pane" /> }),
);

const proc = (status: ProcessSession["status"]): ProcessSession =>
	({
		id: "p1",
		workspaceId: "ws",
		worktreeId: "a",
		terminalSessionId: "t-p1",
		origin: "adHoc",
		presetId: null,
		label: "zsh",
		command: null,
		status,
		lastActivityAt: null,
		lastOutputPreview: null,
		exitCode: null,
		pinned: false,
		attentionState: "idle",
		agentAttentionReasons: {},
		agentAttentionClearedAt: null,
		agentDetected: false,
		provider: null,
	}) as ProcessSession;

const session = { id: "t-p1", workspaceId: "ws", worktreeId: "a", cwd: "/repo", status: "running", exitCode: null } as const;

describe("FloatingShellPopover", () => {
	it("renders the terminal body and wires controls", () => {
		const onMinimize = vi.fn();
		const onPin = vi.fn();
		const onClose = vi.fn();
		render(
			<FloatingShellPopover
				process={proc("running")}
				session={session}
				theme={{} as never}
				pinDisabled={false}
				onMinimize={onMinimize}
				onPin={onPin}
				onClose={onClose}
				onTitleChange={() => {}}
			/>,
		);
		expect(screen.getByTestId("terminal-pane")).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("floating-shell-minimize"));
		expect(onMinimize).toHaveBeenCalledWith("p1");
		fireEvent.click(screen.getByTestId("floating-shell-pin"));
		expect(onPin).toHaveBeenCalledWith("p1");
		fireEvent.click(screen.getByTestId("floating-shell-close"));
		expect(onClose).toHaveBeenCalledWith("p1");
	});

	it("disables pin when pinDisabled or exited", () => {
		const { rerender } = render(
			<FloatingShellPopover
				process={proc("running")}
				session={session}
				theme={{} as never}
				pinDisabled
				onMinimize={() => {}}
				onPin={() => {}}
				onClose={() => {}}
				onTitleChange={() => {}}
			/>,
		);
		expect(screen.getByTestId("floating-shell-pin")).toBeDisabled();
		rerender(
			<FloatingShellPopover
				process={proc("exited")}
				session={session}
				theme={{} as never}
				pinDisabled={false}
				onMinimize={() => {}}
				onPin={() => {}}
				onClose={() => {}}
				onTitleChange={() => {}}
			/>,
		);
		expect(screen.getByTestId("floating-shell-pin")).toBeDisabled();
	});
});
