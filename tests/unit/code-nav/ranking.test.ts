import { describe, expect, it } from "vitest";
import {
	type DefinitionRow,
	rankDefinitions,
} from "../../../electron/code-nav/ranking.js";

function row(o: Partial<DefinitionRow>): DefinitionRow {
	return {
		id: 0,
		qualified_name: "x",
		bare_name: "x",
		file: "x.ts",
		line: 1,
		exported: 0,
		is_default: 0,
		is_declaration_only: 0,
		col: null,
		end_line: null,
		end_col: null,
		...o,
	};
}

describe("rankDefinitions", () => {
	it("exact qualified_name match wins regardless of imports", () => {
		const rows = [
			row({
				id: 1,
				qualified_name: "lib.foo",
				bare_name: "foo",
				file: "lib.ts",
			}),
			row({
				id: 2,
				qualified_name: "src/page.ts::foo",
				bare_name: "foo",
				file: "src/page.ts",
			}),
		];
		const out = rankDefinitions(rows, {
			query: "lib.foo",
			callerFile: "src/page.ts",
			importedFiles: new Set(["src/page.ts"]),
		});
		expect(out[0].id).toBe(1);
	});

	it("imported-file match beats same-dir match", () => {
		const rows = [
			row({ id: 1, bare_name: "foo", file: "lib/foo.ts" }),
			row({ id: 2, bare_name: "foo", file: "src/foo-helper.ts" }),
		];
		const out = rankDefinitions(rows, {
			query: "foo",
			callerFile: "src/page.ts",
			importedFiles: new Set(["lib/foo.ts"]),
		});
		expect(out[0].id).toBe(1);
		expect(out[1].id).toBe(2);
	});

	it("same-dir match beats elsewhere", () => {
		const rows = [
			row({ id: 1, bare_name: "foo", file: "src/helper.ts" }),
			row({ id: 2, bare_name: "foo", file: "other/place.ts" }),
		];
		const out = rankDefinitions(rows, {
			query: "foo",
			callerFile: "src/page.ts",
			importedFiles: new Set(),
		});
		expect(out[0].id).toBe(1);
	});

	it("demotes is_declaration_only within a tier", () => {
		const rows = [
			row({
				id: 1,
				bare_name: "foo",
				file: "lib/foo.ts",
				is_declaration_only: 1,
			}),
			row({
				id: 2,
				bare_name: "foo",
				file: "lib/foo.ts",
				is_declaration_only: 0,
			}),
		];
		const out = rankDefinitions(rows, {
			query: "foo",
			callerFile: "src/x.ts",
			importedFiles: new Set(["lib/foo.ts"]),
		});
		expect(out[0].id).toBe(2);
		expect(out[1].id).toBe(1);
	});
});
