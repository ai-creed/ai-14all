// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IPty } from "node-pty";

const { spawnMock } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
	default: {
		spawn: spawnMock,
	},
}));

import { TerminalService } from "../../../../services/terminals/terminal-service.js";

type ExitHandler = (event: { exitCode: number; signal?: number }) => void;

function createPtyDouble() {
	let exitHandler: ExitHandler | null = null;

	const pty = {
		write: vi.fn(),
		resize: vi.fn(),
		kill: vi.fn(() => {
			exitHandler?.({ exitCode: 0, signal: 15 });
		}),
		onData: vi.fn(),
		onExit: vi.fn((handler: ExitHandler) => {
			exitHandler = handler;
		}),
	} as unknown as IPty;

	return pty;
}

describe("TerminalService", () => {
	beforeEach(() => {
		spawnMock.mockReset();
	});

	it("ignores stale stop and resize commands after a terminal has exited", () => {
		const pty = createPtyDouble();
		spawnMock.mockReturnValue(pty);

		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers);

		const session = service.create("wt1", "/repo");

		expect(() => service.stop(session.id)).not.toThrow();
		expect(pty.kill).toHaveBeenCalledTimes(1);

		expect(() => service.resize(session.id, 120, 40)).not.toThrow();
		expect(() => service.stop(session.id)).not.toThrow();
		expect(pty.resize).not.toHaveBeenCalled();
		expect(pty.kill).toHaveBeenCalledTimes(1);
	});

	it("suppresses PTY exit events while disposing active sessions", () => {
		const pty = createPtyDouble();
		spawnMock.mockReturnValue(pty);

		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers);

		service.create("wt1", "/repo");
		handlers.onState.mockClear();
		handlers.onExit.mockClear();

		expect(() => service.dispose()).not.toThrow();

		expect(pty.kill).toHaveBeenCalledTimes(1);
		expect(handlers.onState).not.toHaveBeenCalled();
		expect(handlers.onExit).not.toHaveBeenCalled();
	});
});
