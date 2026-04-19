import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "../../../shared/models/terminal-session";

const {
	resizeMock,
	sendInputMock,
	onOutputMock,
	logShellEventMock,
	fitMock,
	xtermWriteMock,
	xtermDisposeMock,
	xtermOpenMock,
	xtermLoadAddonMock,
	xtermOnDataMock,
	xtermConstructorMock,
	xtermOnTitleChangeMock,
	xtermAttachCustomKeyEventHandlerMock,
	xtermClearMock,
	xtermScrollToBottomMock,
	xtermScrollLinesMock,
	xtermBufferMock,
	getPathForFileMock,
} = vi.hoisted(() => ({
	resizeMock: vi.fn(() => Promise.resolve()),
	sendInputMock: vi.fn(() => Promise.resolve()),
	onOutputMock: vi.fn(() => vi.fn()),
	logShellEventMock: vi.fn(() => Promise.resolve()),
	fitMock: vi.fn(),
	xtermWriteMock: vi.fn(),
	xtermDisposeMock: vi.fn(),
	xtermOpenMock: vi.fn(),
	xtermLoadAddonMock: vi.fn(),
	xtermOnDataMock: vi.fn(() => ({ dispose: vi.fn() })),
	xtermConstructorMock: vi.fn(),
	xtermOnTitleChangeMock: vi.fn(() => ({ dispose: vi.fn() })),
	xtermAttachCustomKeyEventHandlerMock: vi.fn(),
	xtermClearMock: vi.fn(),
	xtermScrollToBottomMock: vi.fn(),
	xtermScrollLinesMock: vi.fn(),
	xtermBufferMock: { active: { viewportY: 100, baseY: 100, cursorY: 23 } },
	getPathForFileMock: vi.fn<(file: unknown) => string>(),
}));

type ResizeObserverRecord = {
	callback: ResizeObserverCallback;
	observe: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
};

const resizeObserverRecords: ResizeObserverRecord[] = [];

class ResizeObserverMock {
	readonly callback: ResizeObserverCallback;
	readonly observe = vi.fn();
	readonly disconnect = vi.fn();

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		resizeObserverRecords.push(this);
	}
}

vi.mock("../../../src/lib/desktop-client", () => ({
	terminals: {
		sendInput: sendInputMock,
		resize: resizeMock,
		onOutput: onOutputMock,
	},
	workspace: {
		readRestoreState: vi.fn().mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		}),
		writeRestoreState: vi.fn(),
	},
	diagnostics: {
		logShellEvent: logShellEventMock,
	},
	files: {
		getPathForFile: getPathForFileMock,
	},
}));

vi.mock("@xterm/addon-fit", () => ({
	FitAddon: class FitAddonMock {
		fit = fitMock;
	},
}));

vi.mock("xterm", () => ({
	Terminal: class TerminalMock {
		cols = 80;
		rows = 24;
		buffer = xtermBufferMock;
		constructor(options?: unknown) {
			xtermConstructorMock(options);
		}
		loadAddon = xtermLoadAddonMock;
		open = xtermOpenMock;
		onData = xtermOnDataMock;
		onTitleChange = xtermOnTitleChangeMock;
		write = xtermWriteMock;
		dispose = xtermDisposeMock;
		attachCustomKeyEventHandler = xtermAttachCustomKeyEventHandlerMock;
		clear = xtermClearMock;
		scrollToBottom = xtermScrollToBottomMock;
		scrollLines = xtermScrollLinesMock;
	},
}));

import { TerminalPane } from "../../../src/features/terminals/TerminalPane";

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
	return {
		id: "term-1",
		workspaceId: "ws-1",
		worktreeId: "wt1",
		cwd: "/repo",
		status: "running",
		exitCode: null,
		...overrides,
	};
}

describe("TerminalPane", () => {
	beforeEach(() => {
		resizeMock.mockReset();
		sendInputMock.mockReset();
		onOutputMock.mockClear();
		fitMock.mockReset();
		xtermWriteMock.mockReset();
		xtermDisposeMock.mockReset();
		xtermOpenMock.mockReset();
		xtermLoadAddonMock.mockReset();
		xtermOnDataMock.mockReset();
		xtermConstructorMock.mockReset();
		xtermOnTitleChangeMock.mockReset();
		xtermAttachCustomKeyEventHandlerMock.mockReset();
		xtermClearMock.mockReset();
		xtermScrollToBottomMock.mockReset();
		xtermScrollLinesMock.mockReset();
		getPathForFileMock.mockReset();
		xtermBufferMock.active = { viewportY: 100, baseY: 100, cursorY: 23 };
		resizeMock.mockImplementation(() => Promise.resolve());
		sendInputMock.mockImplementation(() => Promise.resolve());
		xtermOnDataMock.mockReturnValue({ dispose: vi.fn() });
		xtermOnTitleChangeMock.mockReturnValue({ dispose: vi.fn() });
		resizeObserverRecords.length = 0;
		vi.stubGlobal("ResizeObserver", ResizeObserverMock);
	});

	it("does not send resize events for a visible exited session", () => {
		const runningSession = makeSession();
		const exitedSession = makeSession({ status: "exited", exitCode: 0 });

		const { rerender } = render(
			<TerminalPane session={runningSession} visible={true} />,
		);

		expect(resizeObserverRecords).toHaveLength(1);
		const runningObserver = resizeObserverRecords[0];
		resizeMock.mockClear();

		rerender(<TerminalPane session={exitedSession} visible={true} />);
		expect(runningObserver.disconnect).toHaveBeenCalledTimes(1);
		expect(resizeObserverRecords).toHaveLength(2);
		const exitedObserver = resizeObserverRecords[1];
		exitedObserver.callback([], exitedObserver as never);

		expect(resizeMock).not.toHaveBeenCalled();
	});

	it("forwards xterm title changes to the callback prop", () => {
		const session = makeSession();
		const onTitleChange = vi.fn();

		render(
			<TerminalPane
				session={session}
				visible={true}
				onTitleChange={onTitleChange}
			/>,
		);

		const titleListener = (xtermOnTitleChangeMock.mock.calls as unknown[][])[0]?.[0] as ((title: string) => void) | undefined;
		expect(typeof titleListener).toBe("function");
		titleListener?.("codex");

		expect(onTitleChange).toHaveBeenCalledWith("codex");
	});

	it("constructs xterm with the bundled powerline font stack and 11px text", () => {
		const session = makeSession();

		render(<TerminalPane session={session} visible={true} />);

		expect(xtermConstructorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				fontFamily: expect.stringContaining("AI14All Terminal Powerline"),
				fontSize: 12,
			}),
		);
	});

	it("clears the xterm buffer on Cmd+K without sending shell input", () => {
		const session = makeSession();

		render(<TerminalPane session={session} visible={true} />);

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock.calls[0]?.[0] as
			| ((event: KeyboardEvent) => boolean)
			| undefined;
		expect(typeof keyHandler).toBe("function");

		const accepted = keyHandler?.(
			new KeyboardEvent("keydown", { key: "k", metaKey: true }),
		);

		expect(accepted).toBe(false);
		expect(xtermClearMock).toHaveBeenCalledTimes(1);
		expect(sendInputMock).not.toHaveBeenCalled();
	});

	it("does not clear the xterm buffer on Cmd+Shift+K", () => {
		const session = makeSession();

		render(<TerminalPane session={session} visible={true} />);

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock.calls[0]?.[0] as
			| ((event: KeyboardEvent) => boolean)
			| undefined;

		const accepted = keyHandler?.(
			new KeyboardEvent("keydown", { key: "k", metaKey: true, shiftKey: true }),
		);

		expect(accepted).toBe(true);
		expect(xtermClearMock).not.toHaveBeenCalled();
	});

	it("sends \\n on Shift+Enter keydown and blocks xterm", () => {
		const session = makeSession();

		render(<TerminalPane session={session} visible={true} />);

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock.calls[0]?.[0] as
			| ((event: KeyboardEvent) => boolean)
			| undefined;

		const accepted = keyHandler?.(
			new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }),
		);

		expect(accepted).toBe(false);
		expect(sendInputMock).toHaveBeenCalledWith("term-1", "\n");
		expect(xtermClearMock).not.toHaveBeenCalled();
	});

	it("blocks xterm on Shift+Enter keypress without sending extra data", () => {
		const session = makeSession();

		render(<TerminalPane session={session} visible={true} />);

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock.calls[0]?.[0] as
			| ((event: KeyboardEvent) => boolean)
			| undefined;

		const accepted = keyHandler?.(
			new KeyboardEvent("keypress", { key: "Enter", shiftKey: true }),
		);

		expect(accepted).toBe(false);
		expect(sendInputMock).not.toHaveBeenCalled();
	});

	it("does not intercept plain Enter", () => {
		const session = makeSession();

		render(<TerminalPane session={session} visible={true} />);

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock.calls[0]?.[0] as
			| ((event: KeyboardEvent) => boolean)
			| undefined;

		const accepted = keyHandler?.(new KeyboardEvent("keydown", { key: "Enter" }));

		expect(accepted).toBe(true);
		expect(sendInputMock).not.toHaveBeenCalled();
	});

	it("preserves cursor-anchored scroll after fit on visibility change", () => {
		const session = makeSession();

		// Cursor in view (cursorAbsY = 100+23 = 123, viewport 100..123)
		xtermBufferMock.active = { viewportY: 100, baseY: 100, cursorY: 23 };

		const { rerender } = render(
			<TerminalPane session={session} visible={false} />,
		);

		xtermScrollLinesMock.mockClear();
		fitMock.mockClear();

		// Simulate fit() shifting the buffer (e.g. reflow added lines)
		fitMock.mockImplementation(() => {
			xtermBufferMock.active = { viewportY: 0, baseY: 110, cursorY: 23 };
		});

		rerender(<TerminalPane session={session} visible={true} />);

		expect(fitMock).toHaveBeenCalled();
		// newCursorAbsY = 110+23 = 133, cursorOffset was 23
		// targetViewportY = 133 - 23 = 110, delta = 110 - 0 = 110
		expect(xtermScrollLinesMock).toHaveBeenCalledWith(110);
	});

	it("restores viewportY after fit when user has scrolled up on visibility change", () => {
		const session = makeSession();

		// User scrolled up: cursor NOT in view (cursorAbsY=100+23=123, viewport 50..73)
		xtermBufferMock.active = { viewportY: 50, baseY: 100, cursorY: 23 };

		const { rerender } = render(
			<TerminalPane session={session} visible={false} />,
		);

		xtermScrollLinesMock.mockClear();
		xtermScrollToBottomMock.mockClear();
		fitMock.mockClear();

		// Simulate fit() resetting viewportY to 0
		fitMock.mockImplementation(() => {
			xtermBufferMock.active = { viewportY: 0, baseY: 100, cursorY: 23 };
		});

		rerender(<TerminalPane session={session} visible={true} />);

		expect(fitMock).toHaveBeenCalled();
		expect(xtermScrollToBottomMock).not.toHaveBeenCalled();
		// Should restore to saved viewportY: delta = 50 - 0 = 50
		expect(xtermScrollLinesMock).toHaveBeenCalledWith(50);
	});

	it("preserves cursor-anchored scroll after fit on container resize", () => {
		const session = makeSession();

		// Cursor in view at bottom
		xtermBufferMock.active = { viewportY: 100, baseY: 100, cursorY: 23 };

		render(<TerminalPane session={session} visible={true} />);

		xtermScrollLinesMock.mockClear();
		fitMock.mockClear();

		// Simulate fit() shifting the buffer
		fitMock.mockImplementation(() => {
			xtermBufferMock.active = { viewportY: 0, baseY: 110, cursorY: 23 };
		});

		// Trigger ResizeObserver callback
		const observer = resizeObserverRecords[0];
		observer.callback([], observer as never);

		expect(fitMock).toHaveBeenCalled();
		// Same math: newCursorAbsY=133, offset=23, target=110, delta=110
		expect(xtermScrollLinesMock).toHaveBeenCalledWith(110);
	});

	it("resolves file paths via webUtils getPathForFile and sends escaped path to PTY on drop", () => {
		const session = makeSession();

		const { container } = render(
			<TerminalPane session={session} visible={true} />,
		);

		sendInputMock.mockClear();

		const file = { name: "file.txt" };
		getPathForFileMock.mockImplementation((f) =>
			f === file ? "/Users/vu/my project/file.txt" : "",
		);

		const section = container.querySelector("section")!;
		const dropEvent = new Event("drop", { bubbles: true });
		Object.defineProperty(dropEvent, "dataTransfer", {
			value: { files: [file] },
		});
		section.dispatchEvent(dropEvent);

		expect(getPathForFileMock).toHaveBeenCalledWith(file);
		expect(sendInputMock).toHaveBeenCalledWith(
			"term-1",
			"/Users/vu/my\\ project/file.txt",
		);
	});

	it("sends multiple escaped file paths separated by spaces on multi-file drop", () => {
		const session = makeSession();

		const { container } = render(
			<TerminalPane session={session} visible={true} />,
		);

		sendInputMock.mockClear();

		const fileA = { name: "a.txt" };
		const fileB = { name: "b file.txt" };
		getPathForFileMock.mockImplementation((f) => {
			if (f === fileA) return "/Users/vu/a.txt";
			if (f === fileB) return "/Users/vu/b file.txt";
			return "";
		});

		const section = container.querySelector("section")!;
		const dropEvent = new Event("drop", { bubbles: true });
		Object.defineProperty(dropEvent, "dataTransfer", {
			value: { files: [fileA, fileB] },
		});
		section.dispatchEvent(dropEvent);

		expect(sendInputMock).toHaveBeenCalledWith(
			"term-1",
			"/Users/vu/a.txt /Users/vu/b\\ file.txt",
		);
	});

	it("does not send input on drop with no files", () => {
		const session = makeSession();

		const { container } = render(
			<TerminalPane session={session} visible={true} />,
		);

		sendInputMock.mockClear();

		const section = container.querySelector("section")!;
		const dropEvent = new Event("drop", { bubbles: true });
		Object.defineProperty(dropEvent, "dataTransfer", {
			value: { files: [] },
		});
		section.dispatchEvent(dropEvent);

		expect(sendInputMock).not.toHaveBeenCalled();
	});

	it("skips files when getPathForFile returns empty string", () => {
		const session = makeSession();

		const { container } = render(
			<TerminalPane session={session} visible={true} />,
		);

		sendInputMock.mockClear();

		const file = { name: "from-web.png" };
		getPathForFileMock.mockReturnValue("");

		const section = container.querySelector("section")!;
		const dropEvent = new Event("drop", { bubbles: true });
		Object.defineProperty(dropEvent, "dataTransfer", {
			value: { files: [file] },
		});
		section.dispatchEvent(dropEvent);

		expect(sendInputMock).not.toHaveBeenCalled();
	});

	it("does not scroll to bottom after resize when user has scrolled up", () => {
		const session = makeSession();

		render(<TerminalPane session={session} visible={true} />);

		// User scrolled up after render
		xtermBufferMock.active = { viewportY: 50, baseY: 100, cursorY: 23 };
		xtermScrollToBottomMock.mockClear();
		fitMock.mockClear();

		const observer = resizeObserverRecords[0];
		observer.callback([], observer as never);

		expect(fitMock).toHaveBeenCalled();
		expect(xtermScrollToBottomMock).not.toHaveBeenCalled();
	});

	it("logs mount and unmount with pane instance metadata", () => {
		const session = makeSession();
		logShellEventMock.mockClear();
		const { unmount } = render(<TerminalPane session={session} visible={true} />);

		expect(logShellEventMock).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "renderer-terminal-mounted",
				source: "renderer",
				data: expect.objectContaining({ terminalSessionId: "term-1" }),
			}),
		);

		unmount();
		expect(logShellEventMock).toHaveBeenCalledWith(
			expect.objectContaining({ event: "renderer-terminal-unmounted" }),
		);
	});
});
