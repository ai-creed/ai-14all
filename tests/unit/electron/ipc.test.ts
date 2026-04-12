// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, handleMock } = vi.hoisted(() => {
	const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
	const handleMock = vi.fn((channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
		handlers.set(channel, handler);
	});
	return { handlers, handleMock };
});

vi.mock("electron", () => ({
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: { handle: handleMock },
}));

import { registerIpcHandlers } from "../../../electron/main/ipc.js";

describe("registerIpcHandlers diagnostics", () => {
	beforeEach(() => {
		handlers.clear();
		handleMock.mockClear();
	});

	it("registers diagnostics:logShellEvent and forwards payload to the log service", async () => {
		const logMock = vi.fn();
		registerIpcHandlers(
			{
				isDestroyed: () => false,
				webContents: { isDestroyed: () => false, send: vi.fn() },
			} as never,
			{
				workspacePersistence: { readState: vi.fn(), writeState: vi.fn() } as never,
				workspaceRegistry: { register: vi.fn(), get: vi.fn() } as never,
				shellEventLog: { log: logMock } as never,
			},
		);

		const handler = handlers.get("diagnostics:logShellEvent");
		expect(handler).toBeTypeOf("function");
		await handler?.({}, {
			source: "renderer",
			event: "renderer-start",
			windowId: 1,
			rendererAt: "2026-04-12T00:00:00.000Z",
			rendererSeq: 1,
			data: {},
		});

		expect(logMock).toHaveBeenCalledWith(
			expect.objectContaining({ event: "renderer-start", rendererSeq: 1 }),
		);
	});

	it("drops malformed diagnostics payloads without throwing", async () => {
		const logMock = vi.fn();
		registerIpcHandlers(
			{
				isDestroyed: () => false,
				webContents: { isDestroyed: () => false, send: vi.fn() },
			} as never,
			{
				workspacePersistence: { readState: vi.fn(), writeState: vi.fn() } as never,
				workspaceRegistry: { register: vi.fn(), get: vi.fn() } as never,
				shellEventLog: { log: logMock } as never,
			},
		);

		const handler = handlers.get("diagnostics:logShellEvent");
		const result = await Promise.resolve(handler?.({}, { bad: true }));
		expect(result).toBeUndefined();
		expect(logMock).not.toHaveBeenCalled();
	});
});
