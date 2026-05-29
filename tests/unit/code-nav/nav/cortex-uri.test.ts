import { describe, expect, it } from "vitest";
import {
	decodeCortexUri,
	encodeCortexUri,
} from "../../../../src/features/code-nav/nav/cortex-uri.js";

describe("cortex URI codec", () => {
	it("round-trips a target", () => {
		const target = {
			workspaceId: "ws1",
			worktreeId: "wt1",
			file: "src/utils.ts",
			line: 42,
			column: 7,
		};
		const uri = encodeCortexUri(target);
		expect(uri).toMatch(
			/^cortex:\/\/nav\/ws1\/wt1\/src\/utils\.ts\?line=42&column=7$/,
		);
		expect(decodeCortexUri(uri)).toEqual(target);
	});

	it("omits column when undefined", () => {
		const target = {
			workspaceId: "ws1",
			worktreeId: "wt1",
			file: "a.ts",
			line: 1,
		};
		const uri = encodeCortexUri(target);
		expect(uri).not.toContain("column=");
		expect(decodeCortexUri(uri)?.column).toBeUndefined();
	});

	it("returns null for non-cortex URIs", () => {
		expect(decodeCortexUri("file:///foo")).toBeNull();
	});
});
