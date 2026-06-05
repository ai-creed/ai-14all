import { describe, expect, it, vi } from "vitest";
import {
	buildDefinitionLocations,
	type DefRow,
} from "../../../../src/features/code-nav/monaco/build-definition-locations.js";

const ref = { workspaceId: "ws1", worktreeId: "/wt", worktreeRoot: "/wt" };

function row(over: Partial<DefRow>): DefRow {
	return {
		id: 0,
		qualified_name: "x",
		bare_name: "x",
		file: "src/x.ts",
		line: 1,
		exported: 0,
		is_default: 0,
		is_declaration_only: 0,
		col: null,
		end_line: null,
		end_col: null,
		...over,
	};
}

describe("buildDefinitionLocations", () => {
	it("builds file:// locations with precise ranges, preserving order", async () => {
		const ensure = vi.fn(async (_r, rel: string) => `file:///wt/${rel}`);
		const out = await buildDefinitionLocations(
			[
				row({ file: "src/a.ts", line: 10, col: 3, end_line: 12, end_col: 7 }),
				row({ file: "src/b.ts", line: 5 }),
			],
			ref,
			ensure,
		);
		expect(out).toEqual([
			{
				uriString: "file:///wt/src/a.ts",
				range: { startLine: 10, startCol: 3, endLine: 12, endCol: 7 },
			},
			{
				uriString: "file:///wt/src/b.ts",
				range: { startLine: 5, startCol: 1, endLine: 5, endCol: 1 },
			},
		]);
	});

	it("omits rows whose model could not be provisioned", async () => {
		const ensure = vi.fn(async (_r, rel: string) =>
			rel === "src/bin.png" ? null : `file:///wt/${rel}`,
		);
		const out = await buildDefinitionLocations(
			[row({ file: "src/bin.png" }), row({ file: "src/a.ts", line: 2 })],
			ref,
			ensure,
		);
		expect(out.map((l) => l.uriString)).toEqual(["file:///wt/src/a.ts"]);
	});

	it("sets the __codeNavTestLastDefUri e2e seam to the first built location", async () => {
		const ensure = vi.fn(async (_r, rel: string) => `file:///wt/${rel}`);
		await buildDefinitionLocations(
			[row({ file: "src/a.ts" }), row({ file: "src/b.ts" })],
			ref,
			ensure,
		);
		expect(
			(window as unknown as { __codeNavTestLastDefUri?: string })
				.__codeNavTestLastDefUri,
		).toBe("file:///wt/src/a.ts");
	});
});
