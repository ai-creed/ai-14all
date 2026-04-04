import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "../../../shared/models/terminal-session";

const {
	resizeMock,
	sendInputMock,
	onOutputMock,
	fitMock,
	xtermWriteMock,
	xtermDisposeMock,
	xtermOpenMock,
	xtermLoadAddonMock,
	xtermOnDataMock,
} = vi.hoisted(() => ({
	resizeMock: vi.fn(() => Promise.resolve()),
	sendInputMock: vi.fn(() => Promise.resolve()),
	onOutputMock: vi.fn(() => vi.fn()),
	fitMock: vi.fn(),
	xtermWriteMock: vi.fn(),
	xtermDisposeMock: vi.fn(),
	xtermOpenMock: vi.fn(),
	xtermLoadAddonMock: vi.fn(),
	xtermOnDataMock: vi.fn(() => ({ dispose: vi.fn() })),
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
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		}),
		writeRestoreState: vi.fn(),
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
		loadAddon = xtermLoadAddonMock;
		open = xtermOpenMock;
		onData = xtermOnDataMock;
		write = xtermWriteMock;
		dispose = xtermDisposeMock;
	},
}));

import { TerminalPane } from "../../../src/features/terminals/TerminalPane";

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
		resizeMock.mockImplementation(() => Promise.resolve());
		sendInputMock.mockImplementation(() => Promise.resolve());
		xtermOnDataMock.mockReturnValue({ dispose: vi.fn() });
		resizeObserverRecords.length = 0;
		vi.stubGlobal("ResizeObserver", ResizeObserverMock);
	});

	it("does not send resize events for a visible exited session", () => {
		const runningSession: TerminalSession = {
			id: "term-1",
			worktreeId: "wt1",
			cwd: "/repo",
			status: "running",
			exitCode: null,
		};
		const exitedSession: TerminalSession = {
			...runningSession,
			status: "exited",
			exitCode: 0,
		};

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
});
