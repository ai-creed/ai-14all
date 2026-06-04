import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CortexIndexService } from "../../../electron/code-nav/cortex-index-service.js";
import { ingestCortexStore } from "../../../electron/code-nav/ingest/cortex-store-to-mirror.js";
import { makeCortexFixtureDb } from "./helpers/make-cortex-fixture-db.js";

describe("CortexIndexService", () => {
	let cacheDir: string;
	let svc: CortexIndexService;

	beforeEach(() => {
		cacheDir = mkdtempSync(join(tmpdir(), "code-nav-svc-"));
		svc = new CortexIndexService({ cacheRoot: cacheDir });
		const cortexDb = join(cacheDir, "src.db");
		makeCortexFixtureDb(cortexDb, {
			meta: {
				repoKey: "repo1",
				worktreeKey: "wt1",
				worktreePath: "/fixture/wt",
			},
			functions: [
				{
					qualified_name: "parseConfig",
					file: "src/utils.ts",
					line: 10,
					exported: 1,
				},
				{ qualified_name: "render", file: "src/page.ts", line: 5, exported: 1 },
				{
					qualified_name: "Cli.parse",
					file: "src/utils.ts",
					line: 40,
					is_declaration_only: 1,
				},
			],
			calls: [
				{
					from_key: "src/page.ts::render",
					to_key: "src/utils.ts::parseConfig",
					kind: "call",
				},
				{
					from_key: "src/page.ts::render",
					to_key: "::unknownHelper",
					kind: "call",
				},
			],
			imports: [{ from_path: "src/page.ts", to_path: "src/utils.ts" }],
			files: [
				{ path: "src/page.ts", kind: "file" },
				{ path: "src/utils.ts", kind: "file" },
			],
		});
		ingestCortexStore(cortexDb, svc.dbPathForKeys("repo1", "wt1"));
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
		expect(callers.some((c) => c.qualified_name === "render")).toBe(true);
	});

	it("getFileImports returns imported files", () => {
		const out = svc.getFileImports(wt, { file: "src/page.ts" });
		expect(out).toEqual(["src/utils.ts"]);
	});

	it("getWorktreeStatus returns dirtyAtIndex from meta", () => {
		const out = svc.getWorktreeStatus(wt);
		expect(out.available).toBe(true);
		expect(out.ready).toBe(true);
		expect(out.dirtyAtIndex).toBe(false);
	});

	it("listFiles returns sorted file paths from the files table", () => {
		const out = svc.listFiles(wt);
		expect(out).toEqual(["src/page.ts", "src/utils.ts"]);
	});
});
