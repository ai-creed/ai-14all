import { describe, it, expect } from "vitest";
import { ListTrackedFilesSchema } from "../../../shared/contracts/commands";

describe("ListTrackedFilesSchema", () => {
	it("accepts a valid payload", () => {
		expect(
			ListTrackedFilesSchema.parse({ workspaceId: "workspace:abc", worktreeId: "wt-123" }),
		).toEqual({ workspaceId: "workspace:abc", worktreeId: "wt-123" });
	});
	it("rejects missing workspaceId", () => {
		expect(() => ListTrackedFilesSchema.parse({ worktreeId: "wt-123" })).toThrow();
	});
	it("rejects empty worktreeId", () => {
		expect(() => ListTrackedFilesSchema.parse({ workspaceId: "w", worktreeId: "" })).toThrow();
	});
});
