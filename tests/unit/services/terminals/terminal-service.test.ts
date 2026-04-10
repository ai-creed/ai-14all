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

	it("creates terminal sessions with workspace ownership metadata", () => {
		const pty = createPtyDouble();
		spawnMock.mockReturnValue(pty);

		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers);

		const session = service.create("ws-a", "worktree-a", "/repo-a");
		expect(session.workspaceId).toBe("ws-a");
		expect(session.worktreeId).toBe("worktree-a");
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

		const session = service.create("ws-1", "wt1", "/repo");

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

		service.create("ws-1", "wt1", "/repo");
		handlers.onState.mockClear();
		handlers.onExit.mockClear();

		expect(() => service.dispose()).not.toThrow();

		expect(pty.kill).toHaveBeenCalledTimes(1);
		expect(handlers.onState).not.toHaveBeenCalled();
		expect(handlers.onExit).not.toHaveBeenCalled();
	});

	it("listSessions returns all active sessions", () => {
		const ptyA = createPtyDouble();
		const ptyB = createPtyDouble();
		spawnMock
			.mockReturnValueOnce(ptyA)
			.mockReturnValueOnce(ptyB);

		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers);

		const s1 = service.create("ws-a", "wt1", "/repo-a");
		const s2 = service.create("ws-a", "wt2", "/repo-a/wt2");

		const list = service.listSessions();
		expect(list).toHaveLength(2);
		expect(list.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
	});

	it("listSessions filters by workspaceId", () => {
		const ptyA = createPtyDouble();
		const ptyB = createPtyDouble();
		spawnMock
			.mockReturnValueOnce(ptyA)
			.mockReturnValueOnce(ptyB);

		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers);

		service.create("ws-a", "wt1", "/repo-a");
		const s2 = service.create("ws-b", "wt1", "/repo-b");

		const list = service.listSessions("ws-b");
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe(s2.id);
	});

	it("listSessions returns empty array after dispose", () => {
		const pty = createPtyDouble();
		spawnMock.mockReturnValue(pty);

		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers);

		service.create("ws-a", "wt1", "/repo-a");
		service.dispose();

		expect(service.listSessions()).toEqual([]);
	});

	it("listSessions excludes exited sessions", () => {
		const ptyA = createPtyDouble();
		const ptyB = createPtyDouble();
		spawnMock
			.mockReturnValueOnce(ptyA)
			.mockReturnValueOnce(ptyB);

		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers);

		const s1 = service.create("ws-a", "wt1", "/repo-a");
		service.create("ws-a", "wt2", "/repo-a/wt2");

		service.stop(s1.id);

		const list = service.listSessions();
		expect(list).toHaveLength(1);
		expect(list[0].id).not.toBe(s1.id);
	});
});
