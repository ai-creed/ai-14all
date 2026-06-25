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

describe("FloatingShellPopover dragging", () => {
	const base = {
		process: proc("running"),
		session,
		theme: {} as never,
		pinDisabled: false,
		onMinimize: () => {},
		onPin: () => {},
		onClose: () => {},
		onTitleChange: () => {},
	};

	it("dragging the header switches to a fixed position and persists it", () => {
		const onPositionChange = vi.fn();
		render(
			<FloatingShellPopover {...base} onPositionChange={onPositionChange} />,
		);
		const popover = screen.getByTestId("floating-shell-popover");
		expect(popover).toHaveAttribute("data-dragged", "false");
		const header = popover.querySelector("header") as HTMLElement;
		fireEvent.pointerDown(header, { pointerId: 1, clientX: 10, clientY: 10 });
		fireEvent.pointerMove(header, { pointerId: 1, clientX: 60, clientY: 50 });
		fireEvent.pointerUp(header, { pointerId: 1, clientX: 60, clientY: 50 });
		expect(popover).toHaveAttribute("data-dragged", "true");
		expect(popover.style.position).toBe("fixed");
		expect(onPositionChange).toHaveBeenCalledWith(
			expect.objectContaining({
				left: expect.any(Number),
				top: expect.any(Number),
			}),
		);
	});

	it("does not start a drag when pressing a header control", () => {
		const onPositionChange = vi.fn();
		render(
			<FloatingShellPopover {...base} onPositionChange={onPositionChange} />,
		);
		const popover = screen.getByTestId("floating-shell-popover");
		const pin = screen.getByTestId("floating-shell-pin");
		fireEvent.pointerDown(pin, { pointerId: 1, clientX: 10, clientY: 10 });
		fireEvent.pointerMove(pin, { pointerId: 1, clientX: 60, clientY: 50 });
		fireEvent.pointerUp(pin, { pointerId: 1, clientX: 60, clientY: 50 });
		expect(popover).toHaveAttribute("data-dragged", "false");
		expect(onPositionChange).not.toHaveBeenCalled();
	});

	it("seeds from initialPosition and resets on header double-click", () => {
		const onPositionChange = vi.fn();
		render(
			<FloatingShellPopover
				{...base}
				initialPosition={{ left: 200, top: 150 }}
				onPositionChange={onPositionChange}
			/>,
		);
		const popover = screen.getByTestId("floating-shell-popover");
		expect(popover).toHaveAttribute("data-dragged", "true");
		expect(popover.style.position).toBe("fixed");
		fireEvent.doubleClick(popover.querySelector("header") as HTMLElement);
		expect(popover).toHaveAttribute("data-dragged", "false");
		expect(onPositionChange).toHaveBeenCalledWith(null);
	});
});
