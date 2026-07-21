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

const { appendFileMock, mkdirMock } = vi.hoisted(() => ({
	appendFileMock: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
	mkdirMock: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));

vi.mock("node:fs/promises", () => ({
	appendFile: appendFileMock,
	mkdir: mkdirMock,
}));

import { TerminalService } from "../../../../services/terminals/terminal-service.js";
import { resolveDefaultShell } from "../../../../services/platform/default-shell.js";
import type { PtyMirror } from "../../../../services/pty-inspect/pty-mirror.js";
import { resolvePtyCaptureDir } from "../../../../services/terminals/pty-capture-tee.js";
import {
	TERMINAL_SPAWN_COLS,
	TERMINAL_SPAWN_ROWS,
} from "../../../../shared/constants/terminal-geometry.js";

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

	it("spawns PTYs with the shared geometry constants", () => {
		const pty = createPtyDouble();
		spawnMock.mockReturnValue(pty);
		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers);

		service.create("ws-1", "wt-1", "/tmp");

		expect(spawnMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Array),
			expect.objectContaining({
				cols: TERMINAL_SPAWN_COLS,
				rows: TERMINAL_SPAWN_ROWS,
			}),
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

	it("creates a from-birth mirror teed to PTY output and resize", async () => {
		const pty = createPtyDouble();
		spawnMock.mockReturnValue(pty);
		const created: Array<{ id: string; mirror: PtyMirror }> = [];
		const handlers = {
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onState: vi.fn(),
			onError: vi.fn(),
		};
		const service = new TerminalService(handlers, undefined, undefined, {
			onCreate: (id, mirror) => created.push({ id, mirror }),
			onExit: vi.fn(),
		});

		const meta = service.create("ws-1", "wt-1", "/tmp");
		expect(created).toHaveLength(1);
		// §6.5 geometry parity, asserted BEFORE any resize: mirror construction
		// matches the pty.spawn shared constants (Task 1 asserts the spawn side).
		expect(created[0].mirror.cols).toBe(TERMINAL_SPAWN_COLS);
		expect(created[0].mirror.rows).toBe(TERMINAL_SPAWN_ROWS);

		const onData = (pty.onData as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as (data: string) => void;
		onData("early output\r\n");
		service.resize(meta.id, 132, 43);
		await created[0].mirror.drained();
		expect(created[0].mirror.cols).toBe(132);
		expect(created[0].mirror.snapshotLineText(0)).toBe("early output");
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

	describe("pty capture tee wiring (reflow spec §2)", () => {
		beforeEach(() => {
			appendFileMock.mockReset();
			appendFileMock.mockImplementation(async () => {});
			mkdirMock.mockReset();
			mkdirMock.mockImplementation(async () => {});
		});

		function createServiceWithCapture(captureDir?: string) {
			const pty = createPtyDouble();
			spawnMock.mockReturnValue(pty);
			const handlers = {
				onOutput: vi.fn(),
				onExit: vi.fn(),
				onState: vi.fn(),
				onError: vi.fn(),
			};
			const service = new TerminalService(
				handlers,
				undefined,
				undefined,
				undefined,
				captureDir,
			);
			const session = service.create("ws-a", "worktree-a", "/repo-a");
			const onData = (pty.onData as ReturnType<typeof vi.fn>).mock
				.calls[0]?.[0] as (data: string) => void;
			return { service, session, onData, handlers };
		}

		it("no captureDir injected → writing PTY data performs zero fs calls (reflow spec §2.1)", async () => {
			const { onData } = createServiceWithCapture(undefined);
			onData("hello");
			await new Promise((r) => setImmediate(r));
			expect(mkdirMock).not.toHaveBeenCalled();
			expect(appendFileMock).not.toHaveBeenCalled();
		});

		it("packaged-mode resolver output composes to zero fs calls even with the env var set (reflow spec §2.2)", async () => {
			const { onData } = createServiceWithCapture(
				resolvePtyCaptureDir({
					env: { AI14ALL_PTY_CAPTURE_DIR: "/cap" },
					isPackaged: true,
				}),
			);
			onData("hello");
			await new Promise((r) => setImmediate(r));
			expect(appendFileMock).not.toHaveBeenCalled();
		});

		it("captureDir set → session bytes are appended to <dir>/<sessionId>.bytes", async () => {
			const { session, onData } = createServiceWithCapture("/cap");
			onData("hello");
			await vi.waitFor(() =>
				expect(appendFileMock).toHaveBeenCalledWith(
					`/cap/${session.id}.bytes`,
					"hello",
					"utf8",
				),
			);
		});

		it("a rejected capture append leaves mirror and renderer delivery untouched (reflow spec §2.4)", async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			appendFileMock.mockRejectedValueOnce(new Error("disk full"));
			const { service, session, onData, handlers } =
				createServiceWithCapture("/cap");
			onData("hello");
			// Mirror path: the write is enqueued synchronously in the onData
			// handler and settles via xterm's own write callback — with the
			// capture append already rejected, content must still land.
			const mirror = service.getMirror(session.id);
			expect(mirror).toBeDefined();
			await mirror!.drained();
			mirror!.tick();
			expect(mirror!.snapshotLineText(0)).toContain("hello");
			// Renderer path: OutputBatcher flushes after its normal batch window
			// (its shipped async contract, output-batcher.ts) — the flush must
			// arrive without anything awaiting the capture queue.
			await vi.waitFor(() =>
				expect(handlers.onOutput).toHaveBeenCalledWith(session.id, "hello"),
			);
			// The tee disabled itself and logged exactly once.
			await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
			consoleError.mockRestore();
		});
	});

	describe("viewport ownership (resize-on-watch §4)", () => {
		function makeService() {
			const pty = createPtyDouble();
			spawnMock.mockReturnValue(pty);
			const service = new TerminalService({
				onOutput: vi.fn(),
				onExit: vi.fn(),
				onState: vi.fn(),
				onError: vi.fn(),
			});
			const session = service.create("ws-1", "wt-1", "/repo");
			return { pty, service, session };
		}

		it("tracks desktop geometry from spawn defaults and every resize()", () => {
			const { service, session } = makeService();
			expect(service.getDesktopGeometry(session.id)).toEqual({
				cols: TERMINAL_SPAWN_COLS,
				rows: TERMINAL_SPAWN_ROWS,
			});
			service.resize(session.id, 120, 40);
			expect(service.getDesktopGeometry(session.id)).toEqual({
				cols: 120,
				rows: 40,
			});
		});

		it("phone-owned gates desktop resize(): desired is recorded, PTY untouched", () => {
			const { pty, service, session } = makeService();
			service.setPhoneOwned(session.id, true);
			service.resize(session.id, 132, 44); // simulated desktop auto-fit (§6.6)
			expect(pty.resize).not.toHaveBeenCalled();
			expect(service.getDesktopGeometry(session.id)).toEqual({
				cols: 132,
				rows: 44,
			});
		});

		it("applyWatchResize resizes pty+mirror without touching desktop geometry", () => {
			const { pty, service, session } = makeService();
			service.resize(session.id, 120, 40);
			service.applyWatchResize(session.id, 46, 58);
			expect(pty.resize).toHaveBeenLastCalledWith(46, 58);
			expect(service.getDesktopGeometry(session.id)).toEqual({
				cols: 120,
				rows: 40,
			});
		});

		it("restoreDesktopGeometry clears the gate and applies the CURRENT desired geometry", () => {
			const { pty, service, session } = makeService();
			service.resize(session.id, 120, 40);
			service.setPhoneOwned(session.id, true);
			service.resize(session.id, 100, 30); // desktop resized DURING the watch (§3)
			service.restoreDesktopGeometry(session.id);
			expect(pty.resize).toHaveBeenLastCalledWith(100, 30);
			// gate cleared: desktop resize applies again
			service.resize(session.id, 90, 28);
			expect(pty.resize).toHaveBeenLastCalledWith(90, 28);
		});

		it("restoreDesktopGeometry on a dead session is a safe no-op", () => {
			const { service, session } = makeService();
			service.stop(session.id); // kill → exit → cleanup
			expect(() => service.restoreDesktopGeometry(session.id)).not.toThrow();
			expect(service.getDesktopGeometry(session.id)).toBeUndefined();
		});
	});
});
