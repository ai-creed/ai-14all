// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspacePersistenceService } from "../../../../services/workspace/workspace-persistence-service.js";

describe("WorkspacePersistenceService", () => {
	let tempDir: string;
	let filePath: string;
	let service: WorkspacePersistenceService;

	beforeEach(() => {
		tempDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-restore-")));
		filePath = join(tempDir, "workspace-state.json");
		service = new WorkspacePersistenceService(filePath);
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns default restore state when no file exists", async () => {
		await expect(service.readState()).resolves.toEqual({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
	});

	it("writes and reads restore state", async () => {
		const state = {
			version: 1 as const,
			restorePreference: "alwaysRestore" as const,
			snapshot: {
				repositoryPath: "/repo",
				selectedWorktreeId: "feature-a",
				commandPresets: [{ id: "preset-1", label: "Claude", command: "claude" }],
				worktreeSessions: [
					{
						worktreeId: "feature-a",
						note: "resume here",
						reviewMode: "changes" as const,
						viewerMode: "diff" as const,
						selectedFilePath: null,
						selectedChangedFilePath: "src/index.ts",
						activeProcessSessionId: "process-1",
						nextAdHocNumber: 2,
						processSessions: [
							{
								id: "process-1",
								origin: "adHoc" as const,
								presetId: null,
								label: "shell 1",
								command: null,
								pinned: false,
							},
						],
					},
				],
			},
		};

		await service.writeState(state);

		await expect(service.readState()).resolves.toEqual(state);
		expect(readFileSync(filePath, "utf8")).toContain(
			'"restorePreference": "alwaysRestore"',
		);
	});

	it("falls back to default state when persisted JSON is invalid", async () => {
		mkdirSync(tempDir, { recursive: true });
		writeFileSync(
			filePath,
			'{"version":1,"restorePreference":"prompt","snapshot":',
			"utf8",
		);

		await expect(service.readState()).resolves.toEqual({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
	});
});
