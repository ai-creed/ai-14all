import { z } from "zod";
import type { Repository } from "../models/repository.js";
import type { Worktree } from "../models/worktree.js";
import type { TerminalSession } from "../models/terminal-session.js";
import type { FileView } from "../models/file-view.js";
import type {
	TerminalOutputEvent,
	TerminalExitEvent,
	TerminalStateEvent,
	TerminalErrorEvent,
} from "./events.js";
import { ShellReasonKindSchema } from "../models/shell-event-record.js";
import type { GitChange } from "../models/git-change.js";
import type { GitDiff } from "../models/git-diff.js";
import type { GitSummary } from "../models/git-summary.js";
import type {
	GitCommitDetail,
	GitCommitHistory,
} from "../models/git-commit-review.js";
import type { RemoteStatus } from "../models/git-remote-status.js";
import { PersistedWorkspaceStateV2Schema, type PersistedWorkspaceStateV2 } from "../models/persisted-workspace-state.js";
import type {
	CreateWorktreePreview,
	RemoveWorktreePreview,
} from "../models/worktree-lifecycle.js";

// --- Zod schemas for command payloads ---

export const PickRepositoryRootSchema = z.object({});

export const OpenRepositoryWorkspaceSchema = z.object({ path: z.string() });

export const ListWorktreesSchema = z.object({ workspaceId: z.string() });

export const CreateWorktreeSchema = z.object({ workspaceId: z.string(), name: z.string() });

export const RemoveWorktreeSchema = z.object({ workspaceId: z.string(), worktreeId: z.string() });

export const PreviewCreateWorktreeSchema = z.object({ workspaceId: z.string(), name: z.string() });

export const PreviewRemoveWorktreeSchema = z.object({ workspaceId: z.string(), worktreeId: z.string() });

export const CreateTerminalSessionSchema = z.object({
	workspaceId: z.string(),
	worktreeId: z.string(),
	cwd: z.string(),
});

export const SendTerminalInputSchema = z.object({
	sessionId: z.string(),
	data: z.string(),
});

export const ResizeTerminalSessionSchema = z.object({
	sessionId: z.string(),
	cols: z.number().int().positive(),
	rows: z.number().int().positive(),
});

export const StopTerminalSessionSchema = z.object({
	sessionId: z.string(),
});

export const ListTerminalSessionsSchema = z.object({
	workspaceId: z.string().optional(),
});

export const ListFilesSchema = z.object({
	worktreePath: z.string(),
});

export const ReadFileSchema = z.object({
	worktreePath: z.string(),
	relativePath: z.string(),
});

export const ListGitChangesSchema = z.object({
	worktreePath: z.string(),
});

export const ReadGitDiffSchema = z.object({
	worktreePath: z.string(),
	relativePath: z.string(),
});

export const ListScopedFilesSchema = z.object({
	worktreePath: z.string(),
	relativeRoots: z.array(z.string()),
});

export const ListTrackedFilesSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
});

export const ReadGitSummarySchema = z.object({
	worktreePath: z.string(),
});

export const LogShellEventSchema = z.object({
	source: z.enum(["main", "renderer"]),
	event: z.string(),
	windowId: z.number().int().nullable(),
	rendererAt: z.string().nullable().optional(),
	rendererSeq: z.number().int().positive().nullable().optional(),
	reasonKind: ShellReasonKindSchema.nullable().optional(),
	reason: z.string().nullable().optional(),
	triggerEventId: z.string().nullable().optional(),
	isExpected: z.boolean().nullable().optional(),
	expectedBecause: z.string().nullable().optional(),
	data: z.record(z.string(), z.unknown()),
});

export const ReadWorkspaceRestoreStateSchema = z.object({});

export const WriteWorkspaceRestoreStateSchema = z.object({
	state: PersistedWorkspaceStateV2Schema,
});

export const ReadGitCommitHistorySchema = z.object({
	worktreePath: z.string(),
});

export const ReadGitCommitDetailSchema = z.object({
	worktreePath: z.string(),
	sha: z.string().min(4),
});

export const DiscardGitChangeSchema = z.object({
	worktreePath: z.string(),
	relativePath: z.string(),
});

export const GetGitRemoteStatusSchema = z.object({
	worktreePath: z.string(),
});

export const PushGitBranchSchema = z.object({
	worktreePath: z.string(),
	force: z.boolean(),
});

export const LoadKeybindingsSchema = z.object({});

// --- The API surface exposed to the renderer via the preload bridge ---

export type Ai14AllDesktopApi = {
	repository: {
		pickRoot(): Promise<string | null>;
		listWorktrees(workspaceId: string): Promise<Worktree[]>;
		previewCreateWorktree(workspaceId: string, name: string): Promise<CreateWorktreePreview>;
		createWorktree(workspaceId: string, name: string): Promise<Worktree>;
		previewRemoveWorktree(workspaceId: string, worktreeId: string): Promise<RemoveWorktreePreview>;
		removeWorktree(workspaceId: string, worktreeId: string): Promise<void>;
	};
	terminals: {
		create(workspaceId: string, worktreeId: string, cwd: string): Promise<TerminalSession>;
		list(workspaceId?: string): Promise<TerminalSession[]>;
		sendInput(sessionId: string, data: string): Promise<void>;
		resize(sessionId: string, cols: number, rows: number): Promise<void>;
		stop(sessionId: string): Promise<void>;
		onOutput(listener: (event: TerminalOutputEvent) => void): () => void;
		onExit(listener: (event: TerminalExitEvent) => void): () => void;
		onState(listener: (event: TerminalStateEvent) => void): () => void;
		onError(listener: (event: TerminalErrorEvent) => void): () => void;
	};
	files: {
		list(worktreePath: string): Promise<string[]>;
		listScoped(
			worktreePath: string,
			relativeRoots: string[],
		): Promise<string[]>;
		listTracked(workspaceId: string, worktreeId: string): Promise<string[]>;
		read(worktreePath: string, relativePath: string): Promise<FileView>;
	};
	git: {
		listChanges(worktreePath: string): Promise<GitChange[]>;
		readDiff(worktreePath: string, relativePath: string): Promise<GitDiff>;
		readSummary(worktreePath: string): Promise<GitSummary>;
		readCommitHistory(worktreePath: string): Promise<GitCommitHistory>;
		readCommitDetail(worktreePath: string, sha: string): Promise<GitCommitDetail>;
		discardChange(worktreePath: string, relativePath: string): Promise<void>;
		getRemoteStatus(worktreePath: string): Promise<RemoteStatus>;
		pushBranch(worktreePath: string, force: boolean): Promise<void>;
	};
	workspace: {
		openRepository(path: string): Promise<{ workspaceId: string; repository: Repository }>;
		readRestoreState(): Promise<PersistedWorkspaceStateV2>;
		writeRestoreState(state: PersistedWorkspaceStateV2): Promise<void>;
		onOpenPicker(listener: () => void): () => void;
	};
	diagnostics: {
		logShellEvent(event: z.infer<typeof LogShellEventSchema>): Promise<void>;
	};
	keyboard: {
		loadKeybindings(): Promise<string | null>;
	};
};
