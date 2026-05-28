import { describe, it, expect } from "vitest";
import {
	ListWorktreeFilesResultSchema,
	ListWorktreeFilesSchema,
} from "../../../shared/contracts/commands";

describe("ListWorktreeFilesSchema", () => {
	it("accepts a valid payload (includeIgnored=false)", () => {
		expect(
			ListWorktreeFilesSchema.parse({
				workspaceId: "workspace:abc",
				worktreeId: "wt-123",
				includeIgnored: false,
			}),
		).toEqual({
			workspaceId: "workspace:abc",
			worktreeId: "wt-123",
			includeIgnored: false,
		});
	});
	it("accepts a valid payload (includeIgnored=true)", () => {
		expect(
			ListWorktreeFilesSchema.parse({
				workspaceId: "w",
				worktreeId: "wt-1",
				includeIgnored: true,
			}),
		).toEqual({ workspaceId: "w", worktreeId: "wt-1", includeIgnored: true });
	});
	it("rejects missing workspaceId", () => {
		expect(() =>
			ListWorktreeFilesSchema.parse({
				worktreeId: "wt-123",
				includeIgnored: false,
			}),
		).toThrow();
	});
	it("rejects empty worktreeId", () => {
		expect(() =>
			ListWorktreeFilesSchema.parse({
				workspaceId: "w",
				worktreeId: "",
				includeIgnored: false,
			}),
		).toThrow();
	});
	it("rejects missing includeIgnored", () => {
		expect(() =>
			ListWorktreeFilesSchema.parse({
				workspaceId: "w",
				worktreeId: "wt-1",
			}),
		).toThrow();
	});
});

describe("ListWorktreeFilesResultSchema", () => {
	it("accepts an array of file entries", () => {
		const r = ListWorktreeFilesResultSchema.parse([
			{ path: "a.ts", ignored: false },
			{ path: ".env", ignored: true },
		]);
		expect(r).toHaveLength(2);
		expect(r[1].ignored).toBe(true);
	});
	it("rejects entries missing the ignored flag", () => {
		expect(() =>
			ListWorktreeFilesResultSchema.parse([{ path: "a.ts" }]),
		).toThrow();
	});
});
