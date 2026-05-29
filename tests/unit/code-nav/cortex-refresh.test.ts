import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CortexIndexService } from "../../../electron/code-nav/cortex-index-service.js";
import { ingestCortexJson } from "../../../electron/code-nav/ingest/json-to-sqlite.js";
import { CortexRefreshController } from "../../../electron/code-nav/refresh/cortex-refresh.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
	spawn: spawnMock,
	default: { spawn: spawnMock },
}));

function makeChild(exitCode: number, stderr = "") {
	type Listener = (code?: number) => void;
	const onListeners = new Map<string, Listener[]>();
	const ee = {
		stderr: {
			on: (_ev: string, cb: (b: Buffer) => void) => {
				if (stderr) cb(Buffer.from(stderr));
			},
		},
		on(ev: string, cb: Listener) {
			const arr = onListeners.get(ev) ?? [];
			arr.push(cb);
			onListeners.set(ev, arr);
			if (ev === "exit") queueMicrotask(() => cb(exitCode));
			return ee;
		},
	};
	return ee;
}

describe("refresh pipeline integration: watcher → CLI stub → ingest → emit", () => {
	let cacheRoot: string;
	let cortexCacheRoot: string;
	let cortexIndex: CortexIndexService;

	beforeEach(() => {
		const root = mkdtempSync(join(tmpdir(), "refresh-int-"));
		cacheRoot = join(root, "svc");
		cortexCacheRoot = join(root, "cortex");
		mkdirSync(join(cortexCacheRoot, "repoA"), { recursive: true });
		cortexIndex = new CortexIndexService({ cacheRoot });
		spawnMock.mockReset();
	});
	afterEach(() => {
		cortexIndex.dispose();
	});

	const baseJson = (fingerprint: string) => ({
		schemaVersion: 3,
		fingerprint,
		worktreePath: "/fixture/wt",
		repoKey: "repoA",
		worktreeKey: "wtA",
		indexedAt: new Date().toISOString(),
		files: [{ path: "a.ts", kind: "file" as const }],
		functions: [{ qualifiedName: "a.ts::foo", file: "a.ts", line: 1 }],
		calls: [],
		imports: [],
	});

	it("CLI exit zero → re-ingest → invalidate → emit", async () => {
		const cortexJsonPath = join(cortexCacheRoot, "repoA", "wtA.json");
		writeFileSync(cortexJsonPath, JSON.stringify(baseJson("v1")));
		ingestCortexJson(
			baseJson("v1"),
			cortexIndex.dbPathForKeys("repoA", "wtA"),
		);

		spawnMock.mockImplementation(() => {
			writeFileSync(cortexJsonPath, JSON.stringify(baseJson("v2")));
			return makeChild(0);
		});

		const emit = vi.fn();
		const toast = vi.fn();
		const refresh = new CortexRefreshController({
			cortexIndex,
			cortexCacheRoot,
			emit,
			toast,
		});

		await refresh.refresh(
			{ worktreePath: "/fixture/wt", repoKey: "repoA", worktreeKey: "wtA" },
			{ workspaceId: "ws1", worktreeId: "wt1" },
		);

		const sidecar = JSON.parse(
			readFileSync(
				cortexIndex
					.dbPathForKeys("repoA", "wtA")
					.replace(/\.sqlite$/, ".meta.json"),
				"utf8",
			),
		);
		expect(sidecar.source_fingerprint).toBe("v2");
		expect(emit).toHaveBeenCalledWith("code-nav:worktreeIndexRefreshed", {
			workspaceId: "ws1",
			worktreeId: "wt1",
		});
		expect(toast).not.toHaveBeenCalled();
	});

	it("CLI exit non-zero → toast, no emit", async () => {
		spawnMock.mockImplementationOnce(() => makeChild(2, "boom"));
		const emit = vi.fn();
		const toast = vi.fn();
		const refresh = new CortexRefreshController({
			cortexIndex,
			cortexCacheRoot,
			emit,
			toast,
		});
		await expect(
			refresh.refresh(
				{ worktreePath: "/fixture/wt", repoKey: "repoA", worktreeKey: "wtA" },
				{ workspaceId: "ws1", worktreeId: "wt1" },
			),
		).rejects.toThrow(/boom/);
		expect(toast).toHaveBeenCalled();
		expect(emit).not.toHaveBeenCalled();
	});
});
