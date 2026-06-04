import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapWorktreeMirror } from "../../../electron/code-nav/refresh/bootstrap-worktree-mirror.js";
import { readAvailabilityMarker } from "../../../electron/code-nav/source/availability-marker.js";
import { makeCortexFixtureDb } from "./helpers/make-cortex-fixture-db.js";

const keys = { worktreePath: "/wt", repoKey: "repoA", worktreeKey: "wtA" };
const ids = { workspaceId: "ws1", worktreeId: "wt1" };

describe("bootstrapWorktreeMirror", () => {
	let root: string;
	let cortexCacheRoot: string;
	let codeNavCacheRoot: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "bootstrap-"));
		cortexCacheRoot = join(root, "cortex");
		codeNavCacheRoot = join(root, "code-nav");
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function deps() {
		return {
			cortexCacheRoot,
			codeNavCacheRoot,
			cortexIndex: { invalidate: vi.fn() },
			emit: vi.fn(),
			mirrorPathForKeys: (r: string, w: string) =>
				join(codeNavCacheRoot, r, `${w}.sqlite`),
		};
	}

	it("no cortex .db → writes marker no-cortex (no spawn)", () => {
		bootstrapWorktreeMirror(deps(), keys, ids);
		expect(readAvailabilityMarker(codeNavCacheRoot, keys)?.reason).toBe(
			"no-cortex",
		);
	});

	it("unsupported-schema .db → writes marker unsupported-schema", () => {
		makeCortexFixtureDb(join(cortexCacheRoot, "repoA", "wtA.db"), {
			meta: { schemaVersion: "3.0" },
			functions: [{ qualified_name: "a", file: "a.ts", line: 1 }],
		});
		bootstrapWorktreeMirror(deps(), keys, ids);
		expect(readAvailabilityMarker(codeNavCacheRoot, keys)?.reason).toBe(
			"unsupported-schema",
		);
	});

	it("supported .db → seeds mirror and clears marker", () => {
		const d = deps();
		makeCortexFixtureDb(join(cortexCacheRoot, "repoA", "wtA.db"), {
			functions: [{ qualified_name: "a", file: "a.ts", line: 1 }],
			files: [{ path: "a.ts", kind: "file" }],
		});
		bootstrapWorktreeMirror(d, keys, ids);
		expect(existsSync(d.mirrorPathForKeys("repoA", "wtA"))).toBe(true);
		expect(readAvailabilityMarker(codeNavCacheRoot, keys)).toBeNull();
		expect(d.emit).toHaveBeenCalledWith("code-nav:worktreeIndexRefreshed", ids);
	});
});
