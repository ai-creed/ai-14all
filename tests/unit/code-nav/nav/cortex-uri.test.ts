import { describe, expect, it } from "vitest";
import {
	decodeCortexUri,
	encodeCortexUri,
} from "../../../../src/features/code-nav/nav/cortex-uri.js";

const PREFIX = "cortex://nav/";

describe("cortex URI codec", () => {
	it("round-trips a target through an opaque, normalization-safe segment", () => {
		const target = {
			workspaceId: "ws1",
			worktreeId: "wt1",
			file: "src/utils.ts",
			line: 42,
			column: 7,
		};
		const uri = encodeCortexUri(target);
		expect(uri.startsWith(PREFIX)).toBe(true);
		// The payload is a single base64url segment — no raw separators a URI
		// normalizer (e.g. monaco.Uri.parse().toString()) would rewrite.
		expect(uri.slice(PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeCortexUri(uri)).toEqual(target);
	});

	it("round-trips when worktreeId is an absolute path (regression: slashes must not become URI path separators)", () => {
		const target = {
			workspaceId: "workspace:abc-123",
			worktreeId: "/private/tmp/x/.worktrees/feature-a",
			file: "src/utils.ts",
			line: 1,
		};
		const uri = encodeCortexUri(target);
		expect(uri.slice(PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeCortexUri(uri)).toEqual({ ...target, column: undefined });
	});

	it("tolerates a trailing slash / query a URI normalizer may append", () => {
		const target = {
			workspaceId: "ws",
			worktreeId: "wt",
			file: "a.ts",
			line: 3,
		};
		const seg = encodeCortexUri(target).slice(PREFIX.length);
		expect(decodeCortexUri(`${PREFIX}${seg}/`)).toEqual({
			...target,
			column: undefined,
		});
		expect(decodeCortexUri(`${PREFIX}${seg}?x=1`)).toEqual({
			...target,
			column: undefined,
		});
	});

	it("omits column when undefined", () => {
		const target = {
			workspaceId: "ws1",
			worktreeId: "wt1",
			file: "a.ts",
			line: 1,
		};
		expect(decodeCortexUri(encodeCortexUri(target))?.column).toBeUndefined();
	});

	it("returns null for non-cortex URIs", () => {
		expect(decodeCortexUri("file:///foo")).toBeNull();
	});

	it("returns null for a malformed payload", () => {
		expect(decodeCortexUri(`${PREFIX}@@not-base64@@`)).toBeNull();
		expect(decodeCortexUri(PREFIX)).toBeNull();
	});
});
