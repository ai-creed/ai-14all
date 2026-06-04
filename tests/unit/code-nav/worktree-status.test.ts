import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CortexIndexService } from "../../../electron/code-nav/cortex-index-service.js";
import { ingestCortexStore } from "../../../electron/code-nav/ingest/cortex-store-to-mirror.js";
import { writeAvailabilityMarker } from "../../../electron/code-nav/source/availability-marker.js";
import { makeCortexFixtureDb } from "./helpers/make-cortex-fixture-db.js";

const keys = {
	worktreePath: "/fixture/wt",
	repoKey: "repoA",
	worktreeKey: "wtA",
};

describe("getWorktreeStatus availability resolution", () => {
	let cacheDir: string;
	let svc: CortexIndexService;
	beforeEach(() => {
		cacheDir = mkdtempSync(join(tmpdir(), "wt-status-"));
		svc = new CortexIndexService({ cacheRoot: cacheDir });
	});
	afterEach(() => {
		svc.dispose();
		rmSync(cacheDir, { recursive: true, force: true });
	});

	it("mirror present → available:true, ready:true, reason null", () => {
		const cortexDb = join(cacheDir, "src.db");
		makeCortexFixtureDb(cortexDb, {
			functions: [{ qualified_name: "a", file: "a.ts", line: 1 }],
		});
		ingestCortexStore(cortexDb, svc.dbPathForKeys("repoA", "wtA"));
		const s = svc.getWorktreeStatus(keys);
		expect(s).toMatchObject({ available: true, ready: true, reason: null });
	});

	it("no mirror + marker no-cortex → available:false, reason no-cortex", () => {
		writeAvailabilityMarker(cacheDir, keys, "no-cortex");
		expect(svc.getWorktreeStatus(keys)).toMatchObject({
			available: false,
			ready: false,
			reason: "no-cortex",
		});
	});

	it("no mirror + marker unsupported-schema → reason unsupported-schema", () => {
		writeAvailabilityMarker(cacheDir, keys, "unsupported-schema", "3.0");
		expect(svc.getWorktreeStatus(keys)).toMatchObject({
			available: false,
			reason: "unsupported-schema",
		});
	});

	it("no mirror + no marker → available:false, reason not-indexed", () => {
		expect(svc.getWorktreeStatus(keys)).toMatchObject({
			available: false,
			reason: "not-indexed",
		});
	});
});
