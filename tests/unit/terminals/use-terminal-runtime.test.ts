import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
	terminals: {
		create: vi.fn(),
		sendInput: vi.fn(),
		resize: vi.fn(),
		stop: vi.fn(),
		list: vi.fn(),
		onOutput: vi.fn(() => vi.fn()),
		onExit: vi.fn(() => vi.fn()),
		onState: vi.fn(() => vi.fn()),
		onError: vi.fn(() => vi.fn()),
	},
	diagnostics: {
		logShellEvent: vi.fn(() => Promise.resolve()),
		logAttentionEvent: vi.fn(),
	},
}));

import { useTerminalRuntime } from "../../../src/app/hooks/use-terminal-runtime";
import {
	getReplayOutput,
	clearReplayOutput,
} from "../../../src/features/terminals/logic/replay-buffer";

const TERM_ID = "term-runtime-replay";

type Options = Parameters<typeof useTerminalRuntime>[0];
type OutputCb = (e: { sessionId: string; data: string }) => void;
type ExitCb = (e: { sessionId: string; exitCode: number | null }) => void;

// Minimal runtime wiring: one workspace whose state maps process `p1` to the
// terminal session under test, so `findProcessByTerminalSessionId` resolves and
// the onOutput handler runs its full record/preview path.
function makeOptions(): Options {
	const process = {
		id: "p1",
		worktreeId: "wt1",
		terminalSessionId: TERM_ID,
		agentDetected: false,
	};
	return {
		appWorkspacesRef: {
			current: {
				activeWorkspaceId: "ws1",
				workspaceOrder: ["ws1"],
				workspacesById: {
					ws1: {
						workspaceId: "ws1",
						worktrees: [],
						workspaceState: {
							selectedWorktreeId: "wt1",
							commandPresets: [],
							processSessionsById: { p1: process },
							sessionsByWorktreeId: {},
							nextAdHocNumberByWorktreeId: {},
						},
					},
				},
			},
		},
		inactiveWorkspaceStatesRef: { current: new Map() },
		dispatch: vi.fn(),
		dispatchAppWorkspaces: vi.fn(),
		getVisibleProcessIds: () => [],
		getActiveWorktreeId: () => "wt1",
	} as unknown as Options;
}

// Render the hook and return the PTY event handlers it subscribed, so a test can
// drive output/exit events directly through the real onOutput/onExit logic.
async function captureHandlers(): Promise<{
	onOutput: OutputCb;
	onExit: ExitCb;
}> {
	const { terminals } = await import("../../../src/lib/desktop-client");
	const captured: { onOutput?: OutputCb; onExit?: ExitCb } = {};
	vi.mocked(terminals.onOutput).mockImplementation((cb) => {
		captured.onOutput = cb as OutputCb;
		return vi.fn();
	});
	vi.mocked(terminals.onExit).mockImplementation((cb) => {
		captured.onExit = cb as ExitCb;
		return vi.fn();
	});
	renderHook(() => useTerminalRuntime(makeOptions()));
	if (!captured.onOutput || !captured.onExit) {
		throw new Error("terminal event handlers were not captured");
	}
	return { onOutput: captured.onOutput, onExit: captured.onExit };
}

describe("useTerminalRuntime replay buffering", () => {
	beforeEach(() => {
		clearReplayOutput(TERM_ID);
	});

	// Regression: a PTY chunk ending in a newline empties the output-preview
	// buffer (consumeOutputPreview returns nextBuffer ""). The onOutput handler
	// must NOT clear the replay buffer on that path — doing so erased
	// already-shown output before a remounted pane could replay it, leaving the
	// terminal blank after an in-workspace session switch for a common
	// line-terminated chunk.
	it("retains replay output for a line-terminated chunk", async () => {
		const { onOutput } = await captureHandlers();

		act(() => {
			onOutput({ sessionId: TERM_ID, data: "MARKER_LINE\n" });
		});

		expect(getReplayOutput(TERM_ID)).toBe("MARKER_LINE\n");
	});

	it("accumulates replay output across multiple chunks", async () => {
		const { onOutput } = await captureHandlers();

		act(() => {
			onOutput({ sessionId: TERM_ID, data: "first line\n" });
			onOutput({ sessionId: TERM_ID, data: "prompt$ " });
		});

		expect(getReplayOutput(TERM_ID)).toBe("first line\nprompt$ ");
	});

	it("clears the replay buffer when the session exits", async () => {
		const { onOutput, onExit } = await captureHandlers();

		act(() => {
			onOutput({ sessionId: TERM_ID, data: "output\n" });
		});
		expect(getReplayOutput(TERM_ID)).toBe("output\n");

		act(() => {
			onExit({ sessionId: TERM_ID, exitCode: 0 });
		});
		expect(getReplayOutput(TERM_ID)).toBe("");
	});
});
