import { z } from "zod";

export const RestorePreferenceSchema = z.enum([
	"prompt",
	"alwaysRestore",
	"alwaysStartClean",
]);

export const PersistedProcessSessionSchema = z.object({
	id: z.string(),
	origin: z.enum(["adHoc", "preset"]),
	presetId: z.string().nullable(),
	label: z.string(),
	command: z.string().nullable(),
	pinned: z.boolean(),
});

export const PersistedWorktreeSessionSchema = z.object({
	worktreeId: z.string(),
	note: z.string(),
	reviewMode: z.enum(["files", "changes", "commits"]),
	viewerMode: z.enum(["file", "diff", "commit"]),
	selectedFilePath: z.string().nullable(),
	selectedChangedFilePath: z.string().nullable(),
	selectedCommitSha: z.string().nullable().optional().default(null),
	selectedCommitFilePath: z.string().nullable().optional().default(null),
	activeProcessSessionId: z.string().nullable(),
	terminalLayoutMode: z.enum(["single", "split"]).optional().default("single"),
	splitLeftProcessId: z.string().nullable().optional().default(null),
	splitRightProcessId: z.string().nullable().optional().default(null),
	nextAdHocNumber: z.number().int().min(1),
	processSessions: z.array(PersistedProcessSessionSchema),
});

export const WorkspaceSnapshotSchema = z.object({
	repositoryPath: z.string(),
	repoId: z.string().nullable().optional().default(null),
	selectedWorktreeId: z.string().nullable(),
	topBandCollapsed: z.boolean().optional().default(false),
	commandPresets: z.array(
		z.object({ id: z.string(), label: z.string(), command: z.string() }),
	),
	worktreeSessions: z.array(PersistedWorktreeSessionSchema),
});

export const PersistedWorkspaceStateSchema = z.object({
	version: z.literal(1),
	restorePreference: RestorePreferenceSchema,
	snapshot: WorkspaceSnapshotSchema.nullable(),
});

export type RestorePreference = z.infer<typeof RestorePreferenceSchema>;
export type PersistedProcessSession = z.infer<
	typeof PersistedProcessSessionSchema
>;
export type PersistedWorktreeSession = z.infer<
	typeof PersistedWorktreeSessionSchema
>;
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;
export type PersistedWorkspaceState = z.infer<
	typeof PersistedWorkspaceStateSchema
>;

export const DEFAULT_PERSISTED_WORKSPACE_STATE: PersistedWorkspaceState = {
	version: 1,
	restorePreference: "prompt",
	snapshot: null,
};
