import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CortexStoreReader } from "../../../electron/code-nav/source/cortex-store-reader.js";
import { makeCortexFixtureDb } from "./helpers/make-cortex-fixture-db.js";

describe("CortexStoreReader", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cortex-reader-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("readMeta returns null when the .db does not exist", () => {
		const r = new CortexStoreReader(join(dir, "missing.db"));
		expect(r.readMeta()).toBeNull();
	});

	it("readMeta parses meta keys and defaults dirtyAtIndex", () => {
		const p = join(dir, "wtA.db");
		makeCortexFixtureDb(p, {
			meta: { schemaVersion: "3.1", fingerprint: "fpX" },
		});
		const meta = new CortexStoreReader(p).readMeta();
		expect(meta).toMatchObject({
			schemaVersion: "3.1",
			fingerprint: "fpX",
			dirtyAtIndex: false,
		});
	});

	it("readGraph returns functions/calls/imports/files with cortex column names", () => {
		const p = join(dir, "wtA.db");
		makeCortexFixtureDb(p, {
			functions: [
				{
					qualified_name: "foo",
					file: "a.ts",
					line: 1,
					col: 1,
					end_line: 3,
					end_col: 2,
				},
			],
			calls: [
				{
					from_key: "a.ts::foo",
					to_key: "::Set",
					kind: "new",
					site_line: 2,
					site_col: 4,
				},
			],
			imports: [{ from_path: "a.ts", to_path: "b.ts" }],
			files: [{ path: "a.ts", kind: "file" }],
		});
		const g = new CortexStoreReader(p).readGraph();
		expect(g.functions[0]).toMatchObject({
			qualified_name: "foo",
			file: "a.ts",
			end_line: 3,
		});
		expect(g.calls[0]).toMatchObject({
			from_key: "a.ts::foo",
			to_key: "::Set",
			site_line: 2,
		});
		expect(g.imports).toEqual([{ from_path: "a.ts", to_path: "b.ts" }]);
		expect(g.files).toEqual([
			{ path: "a.ts", kind: "file", content_hash: null },
		]);
	});
});
