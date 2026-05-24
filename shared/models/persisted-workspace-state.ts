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
	terminalSessionId: z.string().nullable().optional().default(null),
});

/**
 * Persisted shape for a worktree session. Must NOT include
 * `treeExpandedPaths` — expand state is intentionally memory-only and
 * resets on app restart. See
 * docs/superpowers/specs/2026-04-16-worktree-file-tree-design.md §4.6.
 */
export const PersistedWorktreeSessionSchema = z.object({
	worktreeId: z.string(),
	title: z.string().optional().default(""),
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
	// Optional key with NO default: absence is the migration signal — a snapshot
	// written before this feature has these undefined, so hydration resets it to
	// single + one kept shell (see workspace-state restorePersistedSession).
	// Stored loosely as string; hydration narrows to LayoutId.
	terminalLayoutId: z.string().optional(),
	slotProcessIds: z.array(z.string().nullable()).optional(),
	reviewSidebarWidth: z
		.number()
		.int()
		.min(120)
		.max(800)
		.optional()
		.default(280),
	nextAdHocNumber: z.number().int().min(1),
	processSessions: z.array(PersistedProcessSessionSchema),
});

export const WorkspaceSnapshotSchema = z.object({
	repositoryPath: z.string(),
	repoId: z.string().nullable().optional().default(null),
	selectedWorktreeId: z.string().nullable(),
	topBandCollapsed: z.boolean().optional(),
	commandPresets: z.array(
		z.object({ id: z.string(), label: z.string(), command: z.string() }),
	),
	worktreeSessions: z.array(PersistedWorktreeSessionSchema),
});

export const PersistedSavedWorkspaceSchema = z.object({
	workspaceId: z.string(),
	repositoryPath: z.string(),
	repoId: z.string().nullable().optional().default(null),
	snapshot: WorkspaceSnapshotSchema,
});

export const PersistedWorkspaceStateV1Schema = z.object({
	version: z.literal(1),
	restorePreference: RestorePreferenceSchema,
	snapshot: WorkspaceSnapshotSchema.nullable(),
});

export const PersistedWorkspaceStateV2Schema = z.object({
	version: z.literal(2),
	restorePreference: RestorePreferenceSchema,
	activeWorkspaceId: z.string().nullable(),
	workspaceOrder: z.array(z.string()),
	workspaces: z.array(PersistedSavedWorkspaceSchema),
});

export const PersistedWorkspaceStateSchema = z.discriminatedUnion("version", [
	PersistedWorkspaceStateV1Schema,
	PersistedWorkspaceStateV2Schema,
]);

export type RestorePreference = z.infer<typeof RestorePreferenceSchema>;
export type PersistedProcessSession = z.infer<
	typeof PersistedProcessSessionSchema
>;
export type PersistedWorktreeSession = z.infer<
	typeof PersistedWorktreeSessionSchema
>;
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;
export type PersistedSavedWorkspace = z.infer<
	typeof PersistedSavedWorkspaceSchema
>;
export type PersistedWorkspaceStateV1 = z.infer<
	typeof PersistedWorkspaceStateV1Schema
>;
export type PersistedWorkspaceStateV2 = z.infer<
	typeof PersistedWorkspaceStateV2Schema
>;
export type PersistedWorkspaceState =
	| PersistedWorkspaceStateV1
	| PersistedWorkspaceStateV2;

export const DEFAULT_PERSISTED_WORKSPACE_STATE: PersistedWorkspaceStateV2 = {
	version: 2,
	restorePreference: "prompt",
	activeWorkspaceId: null,
	workspaceOrder: [],
	workspaces: [],
};
