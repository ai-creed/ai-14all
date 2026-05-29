import { describe, expect, it } from "vitest";
import { findPathReferences } from "../../../../src/features/code-nav/monaco/document-link-parser.js";

describe("findPathReferences", () => {
	const cases: Array<[
		string,
		Array<{
			path: string;
			line?: number;
			column?: number;
			isAbsolute: boolean;
		}>,
	]> = [
		["see src/utils.ts:42", [{ path: "src/utils.ts", line: 42, isAbsolute: false }]],
		[
			"ref src/utils.ts:42:7",
			[{ path: "src/utils.ts", line: 42, column: 7, isAbsolute: false }],
		],
		["bare src/utils.ts here", [{ path: "src/utils.ts", isAbsolute: false }]],
		["url https://x.com/a/b.ts not matched", []],
		["dotted 3.14 not matched", []],
		[
			"comment // see ./helpers/foo.tsx:10",
			[{ path: "./helpers/foo.tsx", line: 10, isAbsolute: false }],
		],
		[
			"absolute /Users/x/other/foo.ts:5",
			[{ path: "/Users/x/other/foo.ts", line: 5, isAbsolute: true }],
		],
		[
			"absolute no-line /tmp/scratch/a.ts here",
			[{ path: "/tmp/scratch/a.ts", isAbsolute: true }],
		],
		[
			"windows c:\\dev\\foo.ts:7 too",
			[{ path: "c:\\dev\\foo.ts", line: 7, isAbsolute: true }],
		],
	];
	for (const [text, expected] of cases) {
		it(`parses "${text}"`, () => {
			const out = findPathReferences(text).map(
				({ path, line, column, isAbsolute }) => ({
					path,
					line,
					column,
					isAbsolute,
				}),
			);
			const norm = (rows: Record<string, unknown>[]) =>
				rows.map((r) =>
					Object.fromEntries(
						Object.entries(r).filter(([, v]) => v !== undefined),
					),
				);
			expect(norm(out)).toEqual(norm(expected));
		});
	}
});
