import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAvailabilityMarker } from "../../../electron/code-nav/source/availability-marker.js";
import { reconcileAvailability } from "../../../electron/code-nav/refresh/reconcile-availability.js";

const keys = { worktreePath: "/wt", repoKey: "repoA", worktreeKey: "wtA" };
const ids = { workspaceId: "ws1", worktreeId: "wt1" };

describe("reconcileAvailability", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "reconcile-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function deps() {
		return {
			codeNavCacheRoot: root,
			cortexIndex: { invalidate: vi.fn() },
			emit: vi.fn(),
		};
	}

	it("unavailable no-store → writes marker no-cortex + emits worktreeUnavailable", () => {
		const d = deps();
		reconcileAvailability(d, keys, ids, { unavailable: true, reason: "no-store" });
		expect(readAvailabilityMarker(root, keys)?.reason).toBe("no-cortex");
		expect(d.emit).toHaveBeenCalledWith("code-nav:worktreeUnavailable", {
			...ids,
			reason: "no-cortex",
		});
		expect(d.cortexIndex.invalidate).not.toHaveBeenCalled();
	});

	it("unavailable unsupported-schema → marker unsupported-schema with version", () => {
		const d = deps();
		reconcileAvailability(d, keys, ids, {
			unavailable: true,
			reason: "unsupported-schema",
			schemaVersion: "3.0",
		});
		expect(readAvailabilityMarker(root, keys)).toMatchObject({
			reason: "unsupported-schema",
			schemaVersion: "3.0",
		});
	});

	it("success (not skipped) → clears marker, invalidates, emits refreshed", () => {
		const d = deps();
		reconcileAvailability(d, keys, ids, { unavailable: true, reason: "no-store" });
		reconcileAvailability(d, keys, ids, { skipped: false, functionsCount: 2 });
		expect(readAvailabilityMarker(root, keys)).toBeNull();
		expect(d.cortexIndex.invalidate).toHaveBeenCalledWith(keys);
		expect(d.emit).toHaveBeenCalledWith("code-nav:worktreeIndexRefreshed", ids);
	});

	it("skipped success → clears marker but does not emit refreshed", () => {
		const d = deps();
		reconcileAvailability(d, keys, ids, { skipped: true, functionsCount: 2 });
		expect(d.cortexIndex.invalidate).not.toHaveBeenCalled();
		expect(d.emit).not.toHaveBeenCalledWith(
			"code-nav:worktreeIndexRefreshed",
			ids,
		);
	});
});
