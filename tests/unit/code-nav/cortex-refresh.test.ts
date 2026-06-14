import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CortexIndexService } from "../../../electron/code-nav/cortex-index-service.js";
import {
	CortexRefreshController,
	type CortexRefreshDeps,
} from "../../../electron/code-nav/refresh/cortex-refresh.js";
import { readAvailabilityMarker } from "../../../electron/code-nav/source/availability-marker.js";
import { makeCortexFixtureDb } from "./helpers/make-cortex-fixture-db.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
	spawn: spawnMock,
	default: { spawn: spawnMock },
}));

type Listener = (arg?: unknown) => void;
function makeChild(opts: {
	exitCode?: number;
	errorCode?: string;
	stderr?: string;
}) {
	const listeners = new Map<string, Listener[]>();
	const ee = {
		stderr: {
			on: (_ev: string, cb: (b: Buffer) => void) => {
				if (opts.stderr) cb(Buffer.from(opts.stderr));
			},
		},
		on(ev: string, cb: Listener) {
			const arr = listeners.get(ev) ?? [];
			arr.push(cb);
			listeners.set(ev, arr);
			if (ev === "error" && opts.errorCode)
				queueMicrotask(() =>
					cb(Object.assign(new Error("spawn"), { code: opts.errorCode })),
				);
			if (ev === "exit" && opts.exitCode !== undefined)
				queueMicrotask(() => cb(opts.exitCode));
			return ee;
		},
	};
	return ee;
}

const keys = {
	worktreePath: "/fixture/wt",
	repoKey: "repoA",
	worktreeKey: "wtA",
};
const ids = { workspaceId: "ws1", worktreeId: "wt1" };

describe("CortexRefreshController", () => {
	let root: string;
	let codeNavCacheRoot: string;
	let cortexCacheRoot: string;
	let cortexIndex: CortexIndexService;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "refresh-"));
		codeNavCacheRoot = join(root, "code-nav");
		cortexCacheRoot = join(root, "cortex");
		cortexIndex = new CortexIndexService({ cacheRoot: codeNavCacheRoot });
		spawnMock.mockReset();
	});
	afterEach(() => {
		cortexIndex.dispose();
		rmSync(root, { recursive: true, force: true });
	});

	function controller(
		overrides: {
			emit?: (...args: never[]) => void;
			toast?: (...args: never[]) => void;
			isCortexEnabled?: () => boolean;
		} = {},
	) {
		const emit =
			(overrides.emit as CortexRefreshDeps["emit"] | undefined) ?? vi.fn();
		const toast =
			(overrides.toast as CortexRefreshDeps["toast"] | undefined) ?? vi.fn();
		return {
			refresh: new CortexRefreshController({
				cortexIndex,
				cortexCacheRoot,
				codeNavCacheRoot,
				emit,
				toast,
				isCortexEnabled: overrides.isCortexEnabled ?? (() => true),
			}),
			emit,
			toast,
		};
	}

	function writeCortexDb(fingerprint: string) {
		makeCortexFixtureDb(join(cortexCacheRoot, "repoA", "wtA.db"), {
			meta: { fingerprint },
			functions: [{ qualified_name: "foo", file: "a.ts", line: 1 }],
			files: [{ path: "a.ts", kind: "file" }],
		});
	}

	it("CLI exit zero → ingest → invalidate → emit refreshed, marker cleared", async () => {
		spawnMock.mockImplementation(() => {
			writeCortexDb("v2");
			return makeChild({ exitCode: 0 });
		});
		const { refresh, emit, toast } = controller();
		await refresh.refresh(keys, ids);
		expect(spawnMock).toHaveBeenCalledWith(
			"ai-cortex",
			["rehydrate", "/fixture/wt"],
			expect.anything(),
		);
		expect(emit).toHaveBeenCalledWith("code-nav:worktreeIndexRefreshed", ids);
		expect(toast).not.toHaveBeenCalled();
		expect(readAvailabilityMarker(codeNavCacheRoot, keys)).toBeNull();
	});

	it("ai-cortex not installed (ENOENT) → marker no-cortex, no toast, no reject", async () => {
		spawnMock.mockImplementation(() => makeChild({ errorCode: "ENOENT" }));
		const { refresh, emit, toast } = controller();
		await expect(refresh.refresh(keys, ids)).resolves.toBeUndefined();
		expect(readAvailabilityMarker(codeNavCacheRoot, keys)?.reason).toBe(
			"no-cortex",
		);
		expect(emit).toHaveBeenCalledWith("code-nav:worktreeUnavailable", {
			...ids,
			reason: "no-cortex",
		});
		expect(toast).not.toHaveBeenCalled();
	});

	it("old cortex (exit 0, no .db produced) → marker no-cortex, no toast", async () => {
		spawnMock.mockImplementation(() => makeChild({ exitCode: 0 })); // writes no .db
		const { refresh, toast } = controller();
		await refresh.refresh(keys, ids);
		expect(readAvailabilityMarker(codeNavCacheRoot, keys)?.reason).toBe(
			"no-cortex",
		);
		expect(toast).not.toHaveBeenCalled();
	});

	it("transient CLI failure (exit non-zero) → toast + reject, no marker", async () => {
		spawnMock.mockImplementation(() =>
			makeChild({ exitCode: 2, stderr: "boom" }),
		);
		const { refresh, emit, toast } = controller();
		await expect(refresh.refresh(keys, ids)).rejects.toThrow(/boom/);
		expect(toast).toHaveBeenCalled();
		expect(emit).not.toHaveBeenCalled();
		expect(readAvailabilityMarker(codeNavCacheRoot, keys)).toBeNull();
	});

	it("refresh no-ops when cortex is disabled (no spawn, resolves)", async () => {
		const { refresh } = controller({ isCortexEnabled: () => false });
		await expect(refresh.refresh(keys, ids)).resolves.toBeUndefined();
		expect(spawnMock).not.toHaveBeenCalled();
	});
});
