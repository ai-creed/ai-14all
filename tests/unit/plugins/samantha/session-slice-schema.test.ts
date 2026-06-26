import { describe, expect, it } from "vitest";
import { SamanthaSessionSliceSchema } from "../../../../shared/contracts/plugins";

const valid = {
	worktrees: [
		{
			worktreeId: "wt1",
			provider: "claude",
			attention: "waiting",
			summary: "3 tests failing",
			task: "wire theme toggle",
			nextAction: "answer question",
			updatedAt: 1750000000000,
			recent: [
				{
					at: 1750000000000,
					from: "active",
					to: "waiting",
					summary: "3 tests failing",
					source: "mcp",
				},
			],
		},
	],
	app: { focusedWorktreeId: "wt1", mode: "ready" },
};

describe("SamanthaSessionSliceSchema", () => {
	it("accepts a well-formed slice", () => {
		expect(SamanthaSessionSliceSchema.safeParse(valid).success).toBe(true);
	});

	it("rejects an unknown attention state", () => {
		const bad = structuredClone(valid);
		bad.worktrees[0].attention = "exploded";
		expect(SamanthaSessionSliceSchema.safeParse(bad).success).toBe(false);
	});

	it("rejects an unknown app mode", () => {
		const bad = structuredClone(valid);
		bad.app.mode = "fullscreen";
		expect(SamanthaSessionSliceSchema.safeParse(bad).success).toBe(false);
	});

	it("accepts a slice with provider 'cursor' (regression: cursor/antigravity sessions must not be silently dropped)", () => {
		const withCursor = structuredClone(valid);
		withCursor.worktrees[0].provider = "cursor";
		expect(SamanthaSessionSliceSchema.safeParse(withCursor).success).toBe(true);
	});

	it("accepts a slice with provider 'antigravity'", () => {
		const withAntigravity = structuredClone(valid);
		withAntigravity.worktrees[0].provider = "antigravity";
		expect(SamanthaSessionSliceSchema.safeParse(withAntigravity).success).toBe(
			true,
		);
	});
});
