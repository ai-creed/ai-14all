import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import { registerCodeNavIpc } from "../../../electron/code-nav/ipc/register.js";
import { makeCortexFixtureDb } from "./helpers/make-cortex-fixture-db.js";

vi.mock("electron", () => {
	const handlers = new Map<
		string,
		(e: unknown, raw: unknown) => unknown | Promise<unknown>
	>();
	return {
		ipcMain: {
			handle: (
				ch: string,
				h: (e: unknown, raw: unknown) => unknown | Promise<unknown>,
			) => handlers.set(ch, h),
			removeHandler: (ch: string) => handlers.delete(ch),
			__invoke: (ch: string, raw: unknown) =>
				handlers.get(ch)?.(undefined, raw),
		},
	};
});

const fakeKeys = { worktreePath: "/wt", repoKey: "r", worktreeKey: "w" };

function setup(opts: { cortexEnabled?: boolean } = {}) {
	const cortexIndex = {
		findDefinitions: vi.fn().mockReturnValue([]),
		searchSymbols: vi.fn(),
		findCallees: vi.fn(),
		findCallers: vi.fn(),
		getFileImports: vi.fn(),
		getWorktreeStatus: vi.fn(),
		listFiles: vi.fn(),
	};
	const workspaceRegistry = {
		get: vi.fn().mockImplementation((id: string) => {
			if (id !== "ws1") throw new Error("unknown workspace");
			return { id: "ws1" };
		}),
	};
	const worktreeService = {
		findWorktree: vi
			.fn()
			.mockImplementation(async (_r: unknown, id: string) => {
				if (id !== "wt1") throw new Error("unknown worktree");
				return { id, path: fakeKeys.worktreePath };
			}),
	};
	const cortexKeyResolver = {
		resolve: vi.fn().mockImplementation(async (p: string) => {
			if (p === fakeKeys.worktreePath)
				return { repoKey: fakeKeys.repoKey, worktreeKey: fakeKeys.worktreeKey };
			return null;
		}),
	};
	const refreshController = {
		refresh: vi.fn().mockResolvedValue(undefined),
	};
	const watcherController = { watch: vi.fn(), unwatch: vi.fn() };
	const dispose = registerCodeNavIpc({
		workspaceRegistry,
		worktreeService,
		cortexIndex,
		cortexKeyResolver,
		isCortexEnabled: () => opts.cortexEnabled ?? true,
		refreshController,
		watcherController,
	} as unknown as Parameters<typeof registerCodeNavIpc>[0]);
	return {
		dispose,
		cortexIndex,
		workspaceRegistry,
		worktreeService,
		cortexKeyResolver,
	};
}

describe("code-nav IPC trust boundary", () => {
	let teardown: () => void;
	afterEach(() => teardown?.());

	it("rejects payloads missing workspaceId/worktreeId", async () => {
		const { dispose } = setup();
		teardown = dispose;
		await expect(
			(
				ipcMain as unknown as {
					__invoke: (ch: string, raw: unknown) => Promise<unknown>;
				}
			).__invoke("code-nav:findDefinitions", { name: "foo" }),
		).rejects.toThrow();
	});

	it("rejects payloads smuggling worktreePath (zod strict)", async () => {
		const { dispose, cortexKeyResolver } = setup();
		teardown = dispose;
		await expect(
			(
				ipcMain as unknown as {
					__invoke: (ch: string, raw: unknown) => Promise<unknown>;
				}
			).__invoke("code-nav:findDefinitions", {
				workspaceId: "ws1",
				worktreeId: "wt1",
				worktreePath: "/etc",
				name: "foo",
			}),
		).rejects.toThrow();
		expect(cortexKeyResolver.resolve).not.toHaveBeenCalled();
	});

	it("rejects a smuggled key even when cortex is disabled (validate before the gate)", async () => {
		// The cortex-disabled gate must NOT bypass schema validation: the trust
		// boundary has to hold regardless of plugin state, or a disabled cortex
		// silently accepts smuggled keys at the IPC boundary.
		const { dispose, cortexKeyResolver } = setup({ cortexEnabled: false });
		teardown = dispose;
		await expect(
			(
				ipcMain as unknown as {
					__invoke: (ch: string, raw: unknown) => Promise<unknown>;
				}
			).__invoke("code-nav:findDefinitions", {
				workspaceId: "ws1",
				worktreeId: "wt1",
				worktreePath: "/etc",
				name: "foo",
			}),
		).rejects.toThrow();
		// Validation happens before the gate, so no key resolution is attempted.
		expect(cortexKeyResolver.resolve).not.toHaveBeenCalled();
	});

	it("short-circuits a valid payload to [] when cortex is disabled, without resolving keys", async () => {
		const { dispose, cortexKeyResolver, cortexIndex } = setup({
			cortexEnabled: false,
		});
		teardown = dispose;
		const res = await (
			ipcMain as unknown as {
				__invoke: (ch: string, raw: unknown) => Promise<unknown>;
			}
		).__invoke("code-nav:findDefinitions", {
			workspaceId: "ws1",
			worktreeId: "wt1",
			name: "foo",
		});
		expect(res).toEqual([]);
		expect(cortexKeyResolver.resolve).not.toHaveBeenCalled();
		expect(cortexIndex.findDefinitions).not.toHaveBeenCalled();
	});

	it("rejects payloads smuggling any unknown key (e.g. arbitrary cwd)", async () => {
		const { dispose } = setup();
		teardown = dispose;
		await expect(
			(
				ipcMain as unknown as {
					__invoke: (ch: string, raw: unknown) => Promise<unknown>;
				}
			).__invoke("code-nav:searchSymbols", {
				workspaceId: "ws1",
				worktreeId: "wt1",
				query: "foo",
				cwd: "/Users/attacker",
			}),
		).rejects.toThrow();
	});

	it("rejects unknown workspaceId", async () => {
		const { dispose } = setup();
		teardown = dispose;
		await expect(
			(
				ipcMain as unknown as {
					__invoke: (ch: string, raw: unknown) => Promise<unknown>;
				}
			).__invoke("code-nav:findDefinitions", {
				workspaceId: "nope",
				worktreeId: "wt1",
				name: "foo",
			}),
		).rejects.toThrow(/unknown workspace/);
	});

	it("rejects when CortexKeyResolver returns null", async () => {
		const { dispose, cortexKeyResolver } = setup();
		teardown = dispose;
		cortexKeyResolver.resolve.mockResolvedValueOnce(null);
		await expect(
			(
				ipcMain as unknown as {
					__invoke: (ch: string, raw: unknown) => Promise<unknown>;
				}
			).__invoke("code-nav:findDefinitions", {
				workspaceId: "ws1",
				worktreeId: "wt1",
				name: "foo",
			}),
		).rejects.toThrow(/No cortex index|CortexKeysNotFoundError/);
	});

	it("resolves the worktree via registry + resolver and forwards to cortexIndex", async () => {
		const {
			dispose,
			cortexIndex,
			workspaceRegistry,
			worktreeService,
			cortexKeyResolver,
		} = setup();
		teardown = dispose;
		await (
			ipcMain as unknown as {
				__invoke: (ch: string, raw: unknown) => Promise<unknown>;
			}
		).__invoke("code-nav:findDefinitions", {
			workspaceId: "ws1",
			worktreeId: "wt1",
			name: "foo",
		});
		expect(workspaceRegistry.get).toHaveBeenCalledWith("ws1");
		expect(worktreeService.findWorktree).toHaveBeenCalledWith(
			expect.anything(),
			"wt1",
		);
		expect(cortexKeyResolver.resolve).toHaveBeenCalledWith(
			fakeKeys.worktreePath,
		);
		expect(cortexIndex.findDefinitions).toHaveBeenCalledWith(fakeKeys, {
			name: "foo",
			callerFile: undefined,
		});
	});
});

describe("code-nav:e2eIngest seam", () => {
	let teardown: () => void;
	let dir: string;
	let prevE2e: string | undefined;
	beforeEach(() => {
		prevE2e = process.env.AI14ALL_E2E;
		process.env.AI14ALL_E2E = "1";
		dir = mkdtempSync(join(tmpdir(), "e2e-seam-"));
	});
	afterEach(() => {
		teardown?.();
		rmSync(dir, { recursive: true, force: true });
		if (prevE2e === undefined) delete process.env.AI14ALL_E2E;
		else process.env.AI14ALL_E2E = prevE2e;
	});

	it("registers e2eIngest and ingests a cortex .db given cortexDbPath", async () => {
		const cortexDbPath = join(dir, "wtA.db");
		makeCortexFixtureDb(cortexDbPath, {
			functions: [{ qualified_name: "foo", file: "a.ts", line: 1 }],
			files: [{ path: "a.ts", kind: "file" }],
		});
		const dbPath = join(dir, "mirror.sqlite");
		const { dispose } = setup();
		teardown = dispose;
		const res = await (
			ipcMain as unknown as {
				__invoke: (ch: string, raw: unknown) => Promise<unknown>;
			}
		).__invoke("code-nav:e2eIngest", { cortexDbPath, dbPath });
		expect(res).toMatchObject({ skipped: false, functionsCount: 1 });
	});
});
