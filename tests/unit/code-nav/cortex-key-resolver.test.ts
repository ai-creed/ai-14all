import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CortexKeyResolver } from "../../../electron/code-nav/cortex-key-resolver.js";

describe("CortexKeyResolver", () => {
	let cacheRoot: string;
	beforeEach(() => {
		cacheRoot = mkdtempSync(join(tmpdir(), "cortex-keys-"));
		mkdirSync(join(cacheRoot, "repoA"), { recursive: true });
		writeFileSync(
			join(cacheRoot, "repoA", "wtA.meta.json"),
			JSON.stringify({
				worktreePath: "/Users/me/proj",
				repoKey: "repoA",
				worktreeKey: "wtA",
			}),
		);
		writeFileSync(
			join(cacheRoot, "repoA", "wtB.meta.json"),
			JSON.stringify({
				worktreePath: "/Users/me/proj-branch",
				repoKey: "repoA",
				worktreeKey: "wtB",
			}),
		);
	});
	afterEach(() => rmSync(cacheRoot, { recursive: true, force: true }));

	it("reads repoKey/worktreeKey from the sidecar matching the worktree path", async () => {
		const r = new CortexKeyResolver({ cortexCacheRoot: cacheRoot });
		expect(await r.resolve("/Users/me/proj")).toEqual({
			repoKey: "repoA",
			worktreeKey: "wtA",
		});
		expect(await r.resolve("/Users/me/proj-branch")).toEqual({
			repoKey: "repoA",
			worktreeKey: "wtB",
		});
	});

	it("never derives keys when no sidecar matches — returns null", async () => {
		const r = new CortexKeyResolver({ cortexCacheRoot: cacheRoot });
		expect(await r.resolve("/Users/me/unrelated")).toBeNull();
	});

	it("derives repoKey/worktreeKey from the on-disk path when the meta body omits them (ai-cortex's actual schema)", async () => {
		mkdirSync(join(cacheRoot, "17b0417aad28af9d"), { recursive: true });
		writeFileSync(
			join(cacheRoot, "17b0417aad28af9d", "869e41f99b2c1df6.meta.json"),
			JSON.stringify({
				indexedAt: "2026-05-29T02:02:45.172Z",
				fingerprint: "cdb53c42b644eb138e2b028877d2f9607a7e5c76",
				fileCount: 511,
				name: "ai-14all",
				worktreePath: "/Users/me/ai-14all",
			}),
		);
		const r = new CortexKeyResolver({ cortexCacheRoot: cacheRoot });
		expect(await r.resolve("/Users/me/ai-14all")).toEqual({
			repoKey: "17b0417aad28af9d",
			worktreeKey: "869e41f99b2c1df6",
		});
	});

	it("auto-rescans on a cache miss once the throttle window passes (no manual invalidate)", async () => {
		let t = 0;
		const r = new CortexKeyResolver({
			cortexCacheRoot: cacheRoot,
			rescanThrottleMs: 1000,
			now: () => t,
		});
		expect(await r.resolve("/Users/me/new")).toBeNull();

		mkdirSync(join(cacheRoot, "repoB"), { recursive: true });
		writeFileSync(
			join(cacheRoot, "repoB", "wtC.meta.json"),
			JSON.stringify({ worktreePath: "/Users/me/new" }),
		);

		// Within the throttle window: no rescan, still null.
		t = 500;
		expect(await r.resolve("/Users/me/new")).toBeNull();

		// Past the throttle window: rescan picks up the new index.
		t = 1500;
		expect(await r.resolve("/Users/me/new")).toEqual({
			repoKey: "repoB",
			worktreeKey: "wtC",
		});
	});

	it("refreshes its cache when a new sidecar appears", async () => {
		const r = new CortexKeyResolver({ cortexCacheRoot: cacheRoot });
		expect(await r.resolve("/Users/me/new")).toBeNull();
		mkdirSync(join(cacheRoot, "repoB"), { recursive: true });
		writeFileSync(
			join(cacheRoot, "repoB", "wtC.meta.json"),
			JSON.stringify({
				worktreePath: "/Users/me/new",
				repoKey: "repoB",
				worktreeKey: "wtC",
			}),
		);
		r.invalidate();
		expect(await r.resolve("/Users/me/new")).toEqual({
			repoKey: "repoB",
			worktreeKey: "wtC",
		});
	});
});
