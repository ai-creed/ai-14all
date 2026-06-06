import { describe, expect, it } from "vitest";
import { PersistedWorktreeSessionSchema } from "../../../shared/models/persisted-workspace-state";

const baseSession = {
	worktreeId: "wt1",
	note: "",
	reviewMode: "files" as const,
	viewerMode: "file" as const,
	selectedFilePath: null,
	selectedChangedFilePath: null,
	activeProcessSessionId: null,
	nextAdHocNumber: 1,
	processSessions: [],
};

describe("PersistedWorktreeSessionSchema filesPaneMode", () => {
	it("defaults to 'files' when absent (back-compat with pre-feature snapshots)", () => {
		const parsed = PersistedWorktreeSessionSchema.parse(baseSession);
		expect(parsed.filesPaneMode).toBe("files");
	});

	it("preserves an explicit 'symbols' value", () => {
		const parsed = PersistedWorktreeSessionSchema.parse({
			...baseSession,
			filesPaneMode: "symbols",
		});
		expect(parsed.filesPaneMode).toBe("symbols");
	});

	it("rejects an unknown mode", () => {
		expect(() =>
			PersistedWorktreeSessionSchema.parse({
				...baseSession,
				filesPaneMode: "bogus",
			}),
		).toThrow();
	});
});
