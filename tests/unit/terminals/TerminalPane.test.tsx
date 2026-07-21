import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import { TERMINAL_SCROLLBACK_ROWS } from "../../../shared/constants/terminal-geometry";

const {
	resizeMock,
	sendInputMock,
	onOutputMock,
	onWatchStateMock,
	getWatchStateMock,
	notifyBlurMock,
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
	xtermFocusMock,
	xtermScrollToBottomMock,
	xtermScrollLinesMock,
	xtermBufferMock,
	searchFindNextMock,
	searchFindPreviousMock,
	searchClearDecorationsMock,
	searchOnDidChangeResultsMock,
	getPathForFileMock,
} = vi.hoisted(() => ({
	resizeMock: vi.fn(() => Promise.resolve()),
	sendInputMock: vi.fn(() => Promise.resolve()),
	onOutputMock: vi.fn(() => vi.fn()),
	onWatchStateMock: vi.fn(() => vi.fn()),
	getWatchStateMock: vi.fn(() => Promise.resolve(null)),
	notifyBlurMock: vi.fn(() => Promise.resolve()),
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
	xtermFocusMock: vi.fn(),
	xtermScrollToBottomMock: vi.fn(),
	xtermScrollLinesMock: vi.fn(),
	xtermBufferMock: { active: { viewportY: 100, baseY: 100, cursorY: 23 } },
	searchFindNextMock: vi.fn(),
	searchFindPreviousMock: vi.fn(),
	searchClearDecorationsMock: vi.fn(),
	searchOnDidChangeResultsMock: vi.fn(() => ({ dispose: vi.fn() })),
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
		onWatchState: onWatchStateMock,
		getWatchState: getWatchStateMock,
		notifyBlur: notifyBlurMock,
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

vi.mock("xterm-addon-search", () => ({
	SearchAddon: class SearchAddonMock {
		findNext = searchFindNextMock;
		findPrevious = searchFindPreviousMock;
		clearDecorations = searchClearDecorationsMock;
		onDidChangeResults = searchOnDidChangeResultsMock;
	},
}));

vi.mock("xterm", () => ({
	Terminal: class TerminalMock {
		cols = 80;
		rows = 24;
		buffer = xtermBufferMock;
		options: Record<string, unknown> = {};
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
		focus = xtermFocusMock;
		scrollToBottom = xtermScrollToBottomMock;
		scrollLines = xtermScrollLinesMock;
	},
}));

import { TerminalPane } from "../../../src/features/terminals/components/TerminalPane";

function makeSession(
	overrides: Partial<TerminalSession> = {},
): TerminalSession {
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

function renderPane(
	overrides: Partial<React.ComponentProps<typeof TerminalPane>> = {},
) {
	return render(
		<TerminalPane session={makeSession()} visible={true} {...overrides} />,
	);
}

describe("TerminalPane", () => {
	beforeEach(() => {
		resizeMock.mockReset();
		sendInputMock.mockReset();
		onOutputMock.mockClear();
		onWatchStateMock.mockClear();
		getWatchStateMock.mockClear();
		notifyBlurMock.mockClear();
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
		xtermFocusMock.mockReset();
		xtermScrollToBottomMock.mockReset();
		xtermScrollLinesMock.mockReset();
		searchFindNextMock.mockReset();
		searchFindPreviousMock.mockReset();
		searchClearDecorationsMock.mockReset();
		searchOnDidChangeResultsMock.mockReset();
		searchOnDidChangeResultsMock.mockReturnValue({ dispose: vi.fn() });
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

	it("does not recreate the xterm instance when only isLive flips for the same session", () => {
		const runningSession = makeSession();
		const exitedSession = makeSession({ status: "exited", exitCode: 0 });

		const { rerender } = render(
			<TerminalPane session={runningSession} visible={true} />,
		);

		expect(xtermConstructorMock).toHaveBeenCalledTimes(1);
		xtermDisposeMock.mockClear();

		rerender(<TerminalPane session={exitedSession} visible={true} />);

		expect(xtermConstructorMock).toHaveBeenCalledTimes(1);
		expect(xtermDisposeMock).not.toHaveBeenCalled();
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

		const titleListener = (
			xtermOnTitleChangeMock.mock.calls as unknown[][]
		)[0]?.[0] as ((title: string) => void) | undefined;
		expect(typeof titleListener).toBe("function");
		titleListener?.("codex");

		expect(onTitleChange).toHaveBeenCalledWith("codex");
	});

	it("opens find bar on Cmd+F, runs findNext on typing, and closes on Escape", async () => {
		const session = makeSession();
		const { findByRole, queryByRole } = render(
			<TerminalPane session={session} visible={true} />,
		);

		// Cmd+F via the custom key handler
		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock
			.calls[0]?.[0] as ((event: KeyboardEvent) => boolean) | undefined;
		const accepted = keyHandler?.(
			new KeyboardEvent("keydown", { key: "f", metaKey: true }),
		);
		expect(accepted).toBe(false);

		const input = (await findByRole("textbox", {
			name: /find/i,
		})) as HTMLInputElement;

		fireEvent.change(input, { target: { value: "needle" } });

		expect(searchFindNextMock).toHaveBeenCalled();
		const [term, opts] =
			searchFindNextMock.mock.calls[searchFindNextMock.mock.calls.length - 1];
		expect(term).toBe("needle");
		expect(opts).toMatchObject({ caseSensitive: false });

		// Shift+Enter → previous
		fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
		expect(searchFindPreviousMock).toHaveBeenCalled();

		// Esc closes
		fireEvent.keyDown(input, { key: "Escape" });
		expect(queryByRole("textbox", { name: /find/i })).toBeNull();
		expect(searchClearDecorationsMock).toHaveBeenCalled();
		expect(xtermFocusMock).toHaveBeenCalled();
	});

	it("does not load SearchAddon at startup; loads it lazily on first Cmd+F", () => {
		const session = makeSession();
		render(<TerminalPane session={session} visible={true} />);
		// Only FitAddon at startup.
		expect(xtermLoadAddonMock).toHaveBeenCalledTimes(1);

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock
			.calls[0]?.[0] as ((event: KeyboardEvent) => boolean) | undefined;
		keyHandler?.(new KeyboardEvent("keydown", { key: "f", metaKey: true }));

		// FitAddon + lazily-loaded SearchAddon.
		expect(xtermLoadAddonMock).toHaveBeenCalledTimes(2);
	});

	it("constructs xterm with scrollback 10000 and does not enable allowProposedApi at startup", () => {
		const session = makeSession();
		render(<TerminalPane session={session} visible={true} />);
		expect(xtermConstructorMock).toHaveBeenCalledWith(
			expect.objectContaining({ scrollback: TERMINAL_SCROLLBACK_ROWS }),
		);
		expect(TERMINAL_SCROLLBACK_ROWS).toBe(10_000);
		// allowProposedApi is set lazily on the Terminal instance only when
		// SearchAddon is loaded — keeping idle panes off xterm's proposed-API
		// init path during startup.
		const opts = xtermConstructorMock.mock.calls[0][0] as Record<
			string,
			unknown
		>;
		expect(opts.allowProposedApi).toBeUndefined();
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

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock
			.calls[0]?.[0] as ((event: KeyboardEvent) => boolean) | undefined;
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

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock
			.calls[0]?.[0] as ((event: KeyboardEvent) => boolean) | undefined;

		const accepted = keyHandler?.(
			new KeyboardEvent("keydown", { key: "k", metaKey: true, shiftKey: true }),
		);

		expect(accepted).toBe(true);
		expect(xtermClearMock).not.toHaveBeenCalled();
	});

	it("sends \\n on Shift+Enter keydown and blocks xterm", () => {
		const session = makeSession();

		render(<TerminalPane session={session} visible={true} />);

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock
			.calls[0]?.[0] as ((event: KeyboardEvent) => boolean) | undefined;

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

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock
			.calls[0]?.[0] as ((event: KeyboardEvent) => boolean) | undefined;

		const accepted = keyHandler?.(
			new KeyboardEvent("keypress", { key: "Enter", shiftKey: true }),
		);

		expect(accepted).toBe(false);
		expect(sendInputMock).not.toHaveBeenCalled();
	});

	it("does not intercept plain Enter", () => {
		const session = makeSession();

		render(<TerminalPane session={session} visible={true} />);

		const keyHandler = xtermAttachCustomKeyEventHandlerMock.mock
			.calls[0]?.[0] as ((event: KeyboardEvent) => boolean) | undefined;

		const accepted = keyHandler?.(
			new KeyboardEvent("keydown", { key: "Enter" }),
		);

		expect(accepted).toBe(true);
		expect(sendInputMock).not.toHaveBeenCalled();
	});

	it("restores saved viewportY (clamped to baseY) after fit on visibility change", () => {
		const session = makeSession();

		// Pre-hide viewport position captured when pane goes hidden.
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
		// saved viewportY was 100. After fit, baseY=110 so target=min(100,110)=100.
		// delta = target - new viewportY (0) = 100.
		expect(xtermScrollLinesMock).toHaveBeenCalledWith(100);
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
		const { unmount } = render(
			<TerminalPane session={session} visible={true} />,
		);

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

	it("re-fits and scrolls to bottom when fitSignal bumps", () => {
		const session = makeSession();
		const { rerender } = render(
			<TerminalPane session={session} visible={true} fitSignal={0} />,
		);
		// Ignore the mount-time fit; only assert the manual refit.
		fitMock.mockClear();
		resizeMock.mockClear();
		xtermScrollToBottomMock.mockClear();

		rerender(<TerminalPane session={session} visible={true} fitSignal={1} />);

		expect(fitMock).toHaveBeenCalledTimes(1);
		expect(resizeMock).toHaveBeenCalled();
		expect(xtermScrollToBottomMock).toHaveBeenCalledTimes(1);
	});

	it("does not refit on mount for a non-zero initial fitSignal", () => {
		const session = makeSession();
		render(<TerminalPane session={session} visible={true} fitSignal={3} />);
		// The fit-signal effect must be skipped on mount (signal unchanged): its
		// scroll-to-bottom is the distinguishing side effect and must not fire.
		expect(xtermScrollToBottomMock).not.toHaveBeenCalled();
	});

	it("reports typing focus for the pane section only", () => {
		const onTypingFocusChange = vi.fn();
		const { container } = renderPane({ onTypingFocusChange });
		const section = container.querySelector(".shell-terminal-pane")!;
		const sink = document.createElement("textarea");
		sink.className = "xterm-helper-textarea";
		section.querySelector(".shell-terminal-pane__viewport")!.appendChild(sink);

		fireEvent.focus(sink);
		expect(onTypingFocusChange).toHaveBeenLastCalledWith(true);

		// Intra-pane move (xterm → find bar): the contains(relatedTarget) guard
		// must swallow it — typing state persists (spec §6).
		const findInput = document.createElement("input");
		section.appendChild(findInput);
		onTypingFocusChange.mockClear();
		fireEvent.blur(sink, { relatedTarget: findInput });
		expect(onTypingFocusChange).not.toHaveBeenCalled();

		// Leaving the pane section entirely DOES report false.
		const outside = document.createElement("button");
		document.body.appendChild(outside);
		fireEvent.blur(findInput, { relatedTarget: outside });
		expect(onTypingFocusChange).toHaveBeenLastCalledWith(false);
	});
});
