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
import { resolveDefaultShell } from "../../../../services/platform/default-shell.js";

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
		spawnMock.mockReturnValueOnce(ptyA).mockReturnValueOnce(ptyB);

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
		spawnMock.mockReturnValueOnce(ptyA).mockReturnValueOnce(ptyB);

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

	it("spawns the platform default shell with its args", () => {
		const pty = createPtyDouble();
		spawnMock.mockReturnValue(pty);
		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers);

		service.create("ws-a", "worktree-a", "/repo-a");

		const expected = resolveDefaultShell();
		expect(spawnMock).toHaveBeenCalledWith(
			expected.shell,
			expected.args,
			expect.objectContaining({ cwd: "/repo-a" }),
		);
	});

	it("spawns a login shell so profile PATH is available", () => {
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

		expect(spawnMock).toHaveBeenCalledWith(
			expect.any(String),
			["-l"],
			expect.objectContaining({ cwd: "/repo-a" }),
		);
	});

	it("logs create, input, output, missing-session, and exit events", () => {
		const pty = createPtyDouble();
		spawnMock.mockReturnValue(pty);
		const logMock = vi.fn();
		const service = new TerminalService(
			{
				onOutput: vi.fn(),
				onExit: vi.fn(),
				onState: vi.fn(),
				onError: vi.fn(),
			},
			{ log: logMock } as never,
		);

		const session = service.create("ws-a", "wt1", "/repo-a");
		expect(logMock).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "terminal-create-success",
				data: expect.objectContaining({
					terminalSessionId: session.id,
					workspaceId: "ws-a",
				}),
			}),
		);

		service.sendInput(session.id, "echo hi\r");
		expect(logMock).toHaveBeenCalledWith(
			expect.objectContaining({ event: "terminal-send-input" }),
		);

		const onData = (pty.onData as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as (data: string) => void;
		onData("hello\r\n");
		expect(logMock).toHaveBeenCalledWith(
			expect.objectContaining({ event: "terminal-output" }),
		);

		expect(() => service.sendInput("missing", "pwd\r")).toThrow();
		expect(logMock).toHaveBeenCalledWith(
			expect.objectContaining({ event: "terminal-session-missing" }),
		);

		service.stop(session.id);
		expect(logMock).toHaveBeenCalledWith(
			expect.objectContaining({ event: "terminal-exit" }),
		);
	});

	it("logs terminal-binding-changed for each live session on dispose", () => {
		const pty = createPtyDouble();
		spawnMock.mockReturnValue(pty);
		const logMock = vi.fn();
		const service = new TerminalService(
			{
				onOutput: vi.fn(),
				onExit: vi.fn(),
				onState: vi.fn(),
				onError: vi.fn(),
			},
			{ log: logMock } as never,
		);

		const session = service.create("ws-a", "wt1", "/repo-a");
		logMock.mockClear();

		service.dispose();

		expect(logMock).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "terminal-binding-changed",
				reasonKind: "backend_cleanup",
				reason: "service_dispose",
				isExpected: false,
				data: expect.objectContaining({ terminalSessionId: session.id }),
			}),
		);
	});

	it("listSessions excludes exited sessions", () => {
		const ptyA = createPtyDouble();
		const ptyB = createPtyDouble();
		spawnMock.mockReturnValueOnce(ptyA).mockReturnValueOnce(ptyB);

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

	describe("agent-attention lifecycle emits", () => {
		function makeService(appendMock: ReturnType<typeof vi.fn>) {
			return new TerminalService(
				{
					onOutput: vi.fn(),
					onExit: vi.fn(),
					onState: vi.fn(),
					onError: vi.fn(),
				},
				undefined,
				{ append: appendMock } as never,
			);
		}

		function createPtyDoubleWithExit(exitCode: number) {
			const handler: { fn: ExitHandler | null } = { fn: null };
			const pty = {
				write: vi.fn(),
				resize: vi.fn(),
				kill: vi.fn(() => {
					handler.fn?.({ exitCode, signal: 15 });
				}),
				onData: vi.fn(),
				onExit: vi.fn((h: ExitHandler) => {
					handler.fn = h;
				}),
			} as unknown as IPty;
			return pty;
		}

		it("emits an active lifecycle event on successful spawn", () => {
			const pty = createPtyDouble();
			spawnMock.mockReturnValue(pty);
			const appendMock = vi.fn().mockResolvedValue(undefined);
			const service = makeService(appendMock);

			const session = service.create("ws-a", "wt-1", "/repo-a");

			expect(appendMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "lifecycle",
					worktreeId: "wt-1",
					terminalSessionId: session.id,
					provider: null,
					state: "active",
					exitCode: null,
				}),
			);
		});

		it("emits a failed lifecycle event when spawn throws", () => {
			spawnMock.mockImplementation(() => {
				throw new Error("spawn EACCES");
			});
			const appendMock = vi.fn().mockResolvedValue(undefined);
			const service = makeService(appendMock);

			service.create("ws-a", "wt-1", "/repo-a");

			expect(appendMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "lifecycle",
					worktreeId: "wt-1",
					provider: null,
					state: "failed",
					exitCode: null,
				}),
			);
		});

		it("emits active on a clean exit and failed on a non-zero exit", () => {
			const cleanPty = createPtyDoubleWithExit(0);
			const failPty = createPtyDoubleWithExit(1);
			spawnMock.mockReturnValueOnce(cleanPty).mockReturnValueOnce(failPty);
			const appendMock = vi.fn().mockResolvedValue(undefined);
			const service = makeService(appendMock);

			const clean = service.create("ws-a", "wt-1", "/repo-a");
			service.stop(clean.id); // pty double exits with code 0
			expect(appendMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "lifecycle",
					terminalSessionId: clean.id,
					state: "active",
					exitCode: 0,
				}),
			);

			const fail = service.create("ws-a", "wt-2", "/repo-a/wt2");
			service.stop(fail.id); // pty double exits with code 1
			expect(appendMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "lifecycle",
					terminalSessionId: fail.id,
					state: "failed",
					exitCode: 1,
				}),
			);
		});

		it("never throws into the spawn path when append rejects", () => {
			const pty = createPtyDouble();
			spawnMock.mockReturnValue(pty);
			const appendMock = vi.fn().mockRejectedValue(new Error("disk full"));
			const service = makeService(appendMock);

			expect(() => service.create("ws-a", "wt-1", "/repo-a")).not.toThrow();
		});
	});
});
