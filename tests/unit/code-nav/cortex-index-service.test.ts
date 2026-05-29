import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CortexIndexService } from "../../../electron/code-nav/cortex-index-service.js";
import { ingestCortexJson } from "../../../electron/code-nav/ingest/json-to-sqlite.js";

const FIXTURE = resolve(
	process.cwd(),
	"electron/code-nav/ingest/__fixtures__/cortex-tiny.json",
);

describe("CortexIndexService", () => {
	let cacheDir: string;
	let svc: CortexIndexService;

	beforeEach(() => {
		cacheDir = mkdtempSync(join(tmpdir(), "code-nav-svc-"));
		svc = new CortexIndexService({ cacheRoot: cacheDir });
		const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
		const dbPath = svc.dbPathForKeys(json.repoKey, json.worktreeKey);
		ingestCortexJson(json, dbPath);
	});

	afterEach(() => {
		svc.dispose();
		rmSync(cacheDir, { recursive: true, force: true });
	});

	const wt = {
		worktreePath: "/fixture/wt",
		repoKey: "repo1",
		worktreeKey: "wt1",
	};

	it("findDefinitions returns ranked results", () => {
		const out = svc.findDefinitions(wt, {
			name: "parseConfig",
			callerFile: "src/page.ts",
		});
		expect(out.length).toBeGreaterThan(0);
		expect(out[0].file).toBe("src/utils.ts");
	});

	it("searchSymbols uses FTS5 and returns matches", () => {
		const out = svc.searchSymbols(wt, { query: "parseConfig", limit: 10 });
		expect(out.some((r) => r.bare_name === "parseConfig")).toBe(true);
	});

	it("searchSymbols with empty query returns alphabetical first N (no FTS)", () => {
		const out = svc.searchSymbols(wt, { query: "", limit: 50 });
		expect(out.length).toBeGreaterThan(0);
		const names = out.map((r) => r.qualified_name);
		expect(names).toEqual(
			[...names].sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: "base" }),
			),
		);
	});

	it("searchSymbols with whitespace-only query also returns alphabetical first N", () => {
		const out = svc.searchSymbols(wt, { query: "   ", limit: 50 });
		expect(out.length).toBeGreaterThan(0);
	});

	it("findCallers resolves direct callers", () => {
		const def = svc.findDefinitions(wt, { name: "parseConfig" })[0];
		const callers = svc.findCallers(wt, { fnId: def.id });
		expect(callers.length).toBeGreaterThanOrEqual(1);
		expect(callers.some((c) => c.qualified_name === "src/page.ts::render")).toBe(
			true,
		);
	});

	it("getFileImports returns imported files", () => {
		const out = svc.getFileImports(wt, { file: "src/page.ts" });
		expect(out).toEqual(["src/utils.ts"]);
	});

	it("getWorktreeStatus returns dirtyAtIndex from meta", () => {
		const out = svc.getWorktreeStatus(wt);
		expect(out.ready).toBe(true);
		expect(out.dirtyAtIndex).toBe(false);
	});

	it("listFiles returns sorted file paths from the files table", () => {
		const out = svc.listFiles(wt);
		expect(out).toEqual(["src/page.ts", "src/utils.ts"]);
	});
});
