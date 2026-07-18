// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appendFileMock, mkdirMock } = vi.hoisted(() => ({
	appendFileMock: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
	mkdirMock: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));

vi.mock("node:fs/promises", () => ({
	appendFile: appendFileMock,
	mkdir: mkdirMock,
}));

import {
	PtyCaptureTee,
	resolvePtyCaptureDir,
} from "../../../../services/terminals/pty-capture-tee.js";

const flush = () => new Promise((r) => setImmediate(r));

describe("resolvePtyCaptureDir", () => {
	it("returns undefined when the env var is unset or empty", () => {
		expect(
			resolvePtyCaptureDir({ env: {}, isPackaged: false }),
		).toBeUndefined();
		expect(
			resolvePtyCaptureDir({
				env: { AI14ALL_PTY_CAPTURE_DIR: "" },
				isPackaged: false,
			}),
		).toBeUndefined();
	});

	it("returns undefined under packaged mode even with the env var set (production invariant, reflow spec §2)", () => {
		expect(
			resolvePtyCaptureDir({
				env: { AI14ALL_PTY_CAPTURE_DIR: "/cap" },
				isPackaged: true,
			}),
		).toBeUndefined();
	});

	it("returns the dir only for env set + dev mode", () => {
		expect(
			resolvePtyCaptureDir({
				env: { AI14ALL_PTY_CAPTURE_DIR: "/cap" },
				isPackaged: false,
			}),
		).toBe("/cap");
	});
});

describe("PtyCaptureTee", () => {
	beforeEach(() => {
		appendFileMock.mockReset();
		appendFileMock.mockImplementation(async () => {});
		mkdirMock.mockReset();
		mkdirMock.mockImplementation(async () => {});
	});

	it("appends bytes to <dir>/<sessionId>.bytes, creating the dir first", async () => {
		const tee = new PtyCaptureTee("/cap", "s1", vi.fn());
		tee.push("hello");
		await vi.waitFor(() =>
			expect(appendFileMock).toHaveBeenCalledWith(
				"/cap/s1.bytes",
				"hello",
				"utf8",
			),
		);
		expect(mkdirMock).toHaveBeenCalledWith("/cap", { recursive: true });
	});

	it("serializes appends: two chunks pushed while the first write is pending land as A then B (deferred-first-write, reflow spec §2.3)", async () => {
		let resolveFirst!: () => void;
		appendFileMock.mockImplementationOnce(
			() =>
				new Promise<void>((r) => {
					resolveFirst = r;
				}),
		);
		const tee = new PtyCaptureTee("/cap", "s1", vi.fn());
		tee.push("A");
		tee.push("B");
		await vi.waitFor(() => expect(appendFileMock).toHaveBeenCalledTimes(1));
		expect(appendFileMock).toHaveBeenNthCalledWith(
			1,
			"/cap/s1.bytes",
			"A",
			"utf8",
		);
		resolveFirst();
		await vi.waitFor(() => expect(appendFileMock).toHaveBeenCalledTimes(2));
		expect(appendFileMock).toHaveBeenNthCalledWith(
			2,
			"/cap/s1.bytes",
			"B",
			"utf8",
		);
	});

	it("a rejected append disables the tee, drops later chunks with zero fs calls, and logs exactly once (reflow spec §2.4)", async () => {
		appendFileMock.mockRejectedValueOnce(new Error("disk full"));
		const log = vi.fn();
		const tee = new PtyCaptureTee("/cap", "s1", log);
		tee.push("A");
		await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
		appendFileMock.mockClear();
		mkdirMock.mockClear();
		tee.push("B");
		tee.push("C");
		await flush();
		expect(appendFileMock).not.toHaveBeenCalled();
		expect(mkdirMock).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledTimes(1);
	});

	it("push is synchronous and never throws — enqueueing does not await fs", () => {
		mkdirMock.mockRejectedValue(new Error("boom"));
		const tee = new PtyCaptureTee("/cap", "s1", vi.fn());
		expect(() => tee.push("A")).not.toThrow();
	});
});
