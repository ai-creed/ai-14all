import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearAvailabilityMarker,
	readAvailabilityMarker,
	writeAvailabilityMarker,
} from "../../../electron/code-nav/source/availability-marker.js";

const keys = { repoKey: "repoA", worktreeKey: "wtA" };

describe("availability marker", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "avail-marker-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("write then read round-trips reason and schemaVersion", () => {
		writeAvailabilityMarker(root, keys, "unsupported-schema", "3.0");
		expect(readAvailabilityMarker(root, keys)).toMatchObject({
			reason: "unsupported-schema",
			schemaVersion: "3.0",
		});
	});

	it("read returns null when absent; clear removes the marker", () => {
		expect(readAvailabilityMarker(root, keys)).toBeNull();
		writeAvailabilityMarker(root, keys, "no-cortex");
		expect(readAvailabilityMarker(root, keys)).not.toBeNull();
		clearAvailabilityMarker(root, keys);
		expect(readAvailabilityMarker(root, keys)).toBeNull();
	});

	it("clear is a no-op when no marker exists", () => {
		expect(() => clearAvailabilityMarker(root, keys)).not.toThrow();
	});

	it("writes under codeNavCacheRoot at <repoKey>/<worktreeKey>.unavailable.json", () => {
		writeAvailabilityMarker(root, keys, "no-cortex");
		expect(existsSync(join(root, "repoA", "wtA.unavailable.json"))).toBe(true);
	});
});
