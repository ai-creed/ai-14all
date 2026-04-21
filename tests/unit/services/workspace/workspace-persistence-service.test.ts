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
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		});
	});

	it("writes and reads restore state", async () => {
		const state = {
			version: 2 as const,
			restorePreference: "alwaysRestore" as const,
			activeWorkspaceId: "workspace:/repo",
			workspaceOrder: ["workspace:/repo"],
			workspaces: [
				{
					workspaceId: "workspace:/repo",
					repositoryPath: "/repo",
					repoId: null,
					snapshot: {
						repositoryPath: "/repo",
						repoId: null,
						selectedWorktreeId: "feature-a",
						commandPresets: [{ id: "preset-1", label: "Claude", command: "claude" }],
						worktreeSessions: [
							{
								worktreeId: "feature-a",
								title: "",
								note: "resume here",
								reviewMode: "changes" as const,
								reviewDrawerOpen: false,
								viewerMode: "diff" as const,
								selectedFilePath: null,
								selectedChangedFilePath: "src/index.ts",
								selectedCommitSha: null,
								selectedCommitFilePath: null,
								terminalLayoutMode: "single" as const,
								splitLeftProcessId: null,
								splitRightProcessId: null,
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
										terminalSessionId: null,
									},
								],
							},
						],
					},
				},
			],
		};

		await service.writeState(state);

		await expect(service.readState()).resolves.toEqual(state);
		expect(readFileSync(filePath, "utf8")).toContain(
			'"restorePreference": "alwaysRestore"',
		);
	});

	it("falls back to default state and overwrites when persisted JSON is corrupt", async () => {
		mkdirSync(tempDir, { recursive: true });
		writeFileSync(
			filePath,
			'{"version":2,"restorePreference":"prompt","activeWorkspaceId":null,"workspaceOrder":[],"workspaces":',
			"utf8",
		);

		await expect(service.readState()).resolves.toEqual({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		});

		// The corrupt file should have been replaced with a clean default
		const written = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		expect(written).toEqual({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		});
	});

	it("falls back to default state WITHOUT overwriting when JSON is valid but fails schema", async () => {
		mkdirSync(tempDir, { recursive: true });
		// Valid JSON that satisfies JSON.parse but not the Zod schema (e.g. a
		// future schema version with an unknown field or a changed type)
		writeFileSync(
			filePath,
			JSON.stringify({ version: 99, restorePreference: "unknown", snapshot: null }),
			"utf8",
		);

		await expect(service.readState()).resolves.toMatchObject({
			version: 2,
		});

		// The file must NOT have been overwritten — preserve future-version data
		const surviving = JSON.parse(readFileSync(filePath, "utf8")) as { version: number };
		expect(surviving.version).toBe(99);
	});

	it("migrates version 1 restore state into a single v2 workspace entry", async () => {
		writeFileSync(
			filePath,
			JSON.stringify({
				version: 1,
				restorePreference: "prompt",
				snapshot: {
					repositoryPath: "/repo",
					repoId: "repo-id-123",
					selectedWorktreeId: "main",
					commandPresets: [],
					worktreeSessions: [],
				},
			}),
			"utf8",
		);

		const state = await service.readState();
		expect(state.version).toBe(2);
		expect(state.workspaces).toHaveLength(1);
		expect(state.activeWorkspaceId).toBe(state.workspaces[0]?.workspaceId);
		expect(state.workspaces[0]?.snapshot.repositoryPath).toBe("/repo");
	});
});
