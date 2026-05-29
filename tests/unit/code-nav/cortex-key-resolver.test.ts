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
