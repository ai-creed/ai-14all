import { z } from "zod";
import type { Repository } from "../models/repository.js";
import type { Worktree } from "../models/worktree.js";
import type { TerminalSession } from "../models/terminal-session.js";
import type { FileReadResult } from "../models/file-view.js";
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
	GitCommitFileDiff,
	GitCommitFileEntry,
	GitCommitHistory,
} from "../models/git-commit-review.js";
import type { RemoteStatus } from "../models/git-remote-status.js";
import {
	PersistedWorkspaceStateV2Schema,
	type PersistedWorkspaceStateV2,
} from "../models/persisted-workspace-state.js";
import type {
	CreateWorktreePreview,
	RemoveWorktreePreview,
} from "../models/worktree-lifecycle.js";
import type { ReviewComment } from "../models/review-comment.js";
import type {
	ReviewCreateRequest,
	ReviewCommentChangedEvent,
} from "./review-comments.js";
import type { NoteBridgeReply, NoteBridgeRequest } from "./note-bridge.js";
import type {
	AgentAttentionBridgeReply,
	AgentAttentionBridgeRequest,
} from "./agent-attention-bridge.js";

// --- Zod schemas for command payloads ---

export const PickRepositoryRootSchema = z.object({});

export const OpenRepositoryWorkspaceSchema = z.object({ path: z.string() });

export const ListWorktreesSchema = z.object({ workspaceId: z.string() });

export const CreateWorktreeSchema = z.object({
	workspaceId: z.string(),
	name: z.string(),
});

export const RemoveWorktreeSchema = z.object({
	workspaceId: z.string(),
	worktreeId: z.string(),
});

export const PreviewCreateWorktreeSchema = z.object({
	workspaceId: z.string(),
	name: z.string(),
});

export const PreviewRemoveWorktreeSchema = z.object({
	workspaceId: z.string(),
	worktreeId: z.string(),
});

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
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
});

export const ReadFileSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	relativePath: z.string(),
});

export const OpenFileForEditSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	relativePath: z.string(),
});

export const OpenFileForEditResultSchema = z.union([
	z.object({
		ok: z.literal(true),
		content: z.string(),
		mtimeMs: z.number(),
	}),
	z.object({
		ok: z.literal(false),
		reason: z.enum([
			"not-found",
			"not-editable",
			"binary",
			"too-large",
			"permission-denied",
			"path-escape",
			"read-failed",
		]),
	}),
]);

export const SaveFileSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	relativePath: z.string(),
	content: z.string(),
	expectedMtimeMs: z.number(),
});

export const SaveFileResultSchema = z.union([
	z.object({
		ok: z.literal(true),
		mtimeMs: z.number(),
	}),
	z.object({
		ok: z.literal(false),
		reason: z.literal("mtime-conflict"),
		currentMtimeMs: z.number(),
	}),
	z.object({
		ok: z.literal(false),
		reason: z.enum([
			"not-found",
			"not-editable",
			"path-escape",
			"permission-denied",
			"disk-full",
			"write-failed",
		]),
	}),
]);

export type OpenFileForEdit = z.infer<typeof OpenFileForEditSchema>;
export type OpenFileForEditResult = z.infer<typeof OpenFileForEditResultSchema>;
export type SaveFile = z.infer<typeof SaveFileSchema>;
export type SaveFileResult = z.infer<typeof SaveFileResultSchema>;
export type WorktreeFileEntry = {
	path: string;
	ignored: boolean;
};

export const SetEditorDirtySchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	relativePath: z.string().min(1),
	dirty: z.boolean(),
});

export const ConfirmCloseSchema = z.object({
	proceed: z.boolean(),
});

export const RequestCloseSchema = z.object({
	keys: z.array(z.string()),
});

export type SetEditorDirty = z.infer<typeof SetEditorDirtySchema>;
export type ConfirmClose = z.infer<typeof ConfirmCloseSchema>;
export type RequestClose = z.infer<typeof RequestCloseSchema>;

export const ListGitChangesSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
});

export const ReadGitDiffSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	relativePath: z.string(),
});

export const ListScopedFilesSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	relativeRoots: z.array(z.string()),
});

export const ListWorktreeFilesSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	includeIgnored: z.boolean(),
});

export const WorktreeFileEntrySchema = z.object({
	path: z.string(),
	ignored: z.boolean(),
});

export const ListWorktreeFilesResultSchema = z.array(WorktreeFileEntrySchema);

export const ReadGitSummarySchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
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

// One-way channel for diagnostic agent-attention events (fire-and-forget;
// `ipcRenderer.send`, not `invoke`). The canonical event union and its Zod
// validator (`AttentionLogEvent` / `AttentionLogEventSchema`) live in
// `services/diagnostics/agent-attention-logger.ts`; `shared/` must not import
// from `services/`, so the renderer-facing union is mirrored here (same
// rationale as the preload duplicating channel-name constants). The main
// handler re-validates with the canonical schema before persisting.
export const DIAGNOSTICS_ATTENTION_EVENT = "diagnostics:attention-event";

type AttentionLogProvider = "claude" | "codex" | "other" | null;

export type DiagnosticsAttentionLogEvent =
	| {
			type: "classifier";
			ts: number;
			worktreeId: string;
			processId: string;
			provider: AttentionLogProvider;
			state: "waiting" | "ready" | "failed" | "stale";
			matchedPattern: string;
			inputSample: string;
			inputPrev: string;
	  }
	| {
			type: "mcp";
			ts: number;
			worktreeId: string;
			provider: AttentionLogProvider;
			state: "active" | "waiting" | "ready" | "failed";
			summary: string;
			task: string | null | undefined;
			nextAction: string | null;
	  }
	| {
			type: "lifecycle";
			ts: number;
			worktreeId: string;
			// Backend `TerminalSession.id` — NOT the renderer `ProcessSession.id`
			// that classifier/resolution carry as `processId`. Joins to those
			// events by `worktreeId` + time (and to a `ProcessSession` via its
			// `terminalSessionId`). See `LifecycleLogEvent` in
			// services/diagnostics/agent-attention-logger.ts for the rationale.
			terminalSessionId: string;
			provider: AttentionLogProvider;
			state: "active" | "failed";
			exitCode: number | null;
	  }
	| {
			type: "resolution";
			ts: number;
			worktreeId: string;
			processId: string | null;
			provider: AttentionLogProvider;
			before: { state: string; source: string; summary?: string } | null;
			after: { state: string; source: string; summary?: string } | null;
	  };

export const ReadWorkspaceRestoreStateSchema = z.object({});

export const WriteWorkspaceRestoreStateSchema = z.object({
	state: PersistedWorkspaceStateV2Schema,
});

export const ReadGitCommitHistorySchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
});

export const ReadGitCommitDetailSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	sha: z.string().min(4),
});

export const ReadGitCommitFileDiffSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	sha: z.string().min(4),
	file: z.object({
		path: z.string().min(1),
		oldPath: z.string().nullable(),
		status: z.enum(["A", "M", "D", "R"]),
	}),
});

export const DiscardGitChangeSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	relativePath: z.string(),
});

export const GetGitRemoteStatusSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
});

export const PushGitBranchSchema = z.object({
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
	force: z.boolean(),
});

// --- Shared types ---

export interface UpdateInfo {
	version: string;
	url: string;
	releaseDate: string;
}

// --- The API surface exposed to the renderer via the preload bridge ---

export type Ai14AllDesktopApi = {
	repository: {
		pickRoot(): Promise<string | null>;
		listWorktrees(workspaceId: string): Promise<Worktree[]>;
		previewCreateWorktree(
			workspaceId: string,
			name: string,
		): Promise<CreateWorktreePreview>;
		createWorktree(workspaceId: string, name: string): Promise<Worktree>;
		previewRemoveWorktree(
			workspaceId: string,
			worktreeId: string,
		): Promise<RemoveWorktreePreview>;
		removeWorktree(workspaceId: string, worktreeId: string): Promise<void>;
	};
	terminals: {
		create(
			workspaceId: string,
			worktreeId: string,
			cwd: string,
		): Promise<TerminalSession>;
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
		list(workspaceId: string, worktreeId: string): Promise<string[]>;
		listScoped(
			workspaceId: string,
			worktreeId: string,
			relativeRoots: string[],
		): Promise<string[]>;
		listWorktree(
			workspaceId: string,
			worktreeId: string,
			opts: { includeIgnored: boolean },
		): Promise<WorktreeFileEntry[]>;
		read(
			workspaceId: string,
			worktreeId: string,
			relativePath: string,
		): Promise<FileReadResult>;
		openForEdit(
			workspaceId: string,
			worktreeId: string,
			relativePath: string,
		): Promise<OpenFileForEditResult>;
		save(args: {
			workspaceId: string;
			worktreeId: string;
			relativePath: string;
			content: string;
			expectedMtimeMs: number;
		}): Promise<SaveFileResult>;
		getPathForFile(file: File): string;
	};
	git: {
		listChanges(workspaceId: string, worktreeId: string): Promise<GitChange[]>;
		readDiff(
			workspaceId: string,
			worktreeId: string,
			relativePath: string,
		): Promise<GitDiff>;
		readSummary(workspaceId: string, worktreeId: string): Promise<GitSummary>;
		readCommitHistory(
			workspaceId: string,
			worktreeId: string,
		): Promise<GitCommitHistory>;
		readCommitDetail(
			workspaceId: string,
			worktreeId: string,
			sha: string,
		): Promise<GitCommitDetail>;
		readCommitFileDiff(
			workspaceId: string,
			worktreeId: string,
			sha: string,
			file: GitCommitFileEntry,
		): Promise<GitCommitFileDiff>;
		discardChange(
			workspaceId: string,
			worktreeId: string,
			relativePath: string,
		): Promise<void>;
		getRemoteStatus(
			workspaceId: string,
			worktreeId: string,
		): Promise<RemoteStatus>;
		pushBranch(
			workspaceId: string,
			worktreeId: string,
			force: boolean,
		): Promise<void>;
	};
	workspace: {
		openRepository(
			path: string,
		): Promise<{ workspaceId: string; repository: Repository }>;
		readRestoreState(): Promise<PersistedWorkspaceStateV2>;
		writeRestoreState(state: PersistedWorkspaceStateV2): Promise<void>;
		onOpenPicker(listener: () => void): () => void;
	};
	diagnostics: {
		logShellEvent(event: z.infer<typeof LogShellEventSchema>): Promise<void>;
		logAttentionEvent(event: DiagnosticsAttentionLogEvent): void;
		getAgentAttentionStatus(): Promise<{
			mode: "off" | "sampled" | "full";
			logsDir: string;
		}>;
	};
	system: {
		onUpdateAvailable(listener: (info: UpdateInfo) => void): () => void;
		onUpdateDownloaded(listener: (info: UpdateInfo) => void): () => void;
		onUpdateError(listener: (message: string) => void): () => void;
		installUpdate(): Promise<void>;
		openExternal(url: string): Promise<void>;
	};
	usage: {
		onSnapshot(
			listener: (snapshot: import("../models/usage.js").UsageSnapshot) => void,
		): () => void;
		setEnabled(enabled: boolean): Promise<void>;
		setBudgets(
			fiveHourBudget: number | null,
			weeklyBudget: number | null,
		): Promise<void>;
		setWeeklyReset(
			weeklyResetDay: number,
			weeklyResetHour: number,
		): Promise<void>;
		setIncludeUntracked(includeUntracked: boolean): Promise<void>;
	};
	reviewComments: {
		list(worktreeId: string): Promise<{ comments: ReviewComment[] }>;
		create(input: ReviewCreateRequest): Promise<{ comment: ReviewComment }>;
		markAddressed(
			commentId: string,
		): Promise<
			{ ok: true } | { ok: false; error: "not_found" | "already_addressed" }
		>;
		reopen(commentId: string): Promise<{ comment: ReviewComment | null }>;
		delete(commentId: string): Promise<{ deleted: boolean }>;
		update(
			commentId: string,
			body: string,
		): Promise<
			| { ok: true; comment: ReviewComment }
			| { ok: false; error: "not_found" | "not_open" | "empty_body" }
		>;
		bulkRemoveAddressed(
			worktreeId: string,
			ids: string[],
		): Promise<
			| { ok: true; removed: number }
			| {
					ok: false;
					error: "worktree_mismatch" | "not_found" | "not_addressed";
			  }
		>;
		rebaseWorktreeIds(mapping: Record<string, string>): Promise<{ ok: true }>;
		onChanged(handler: (event: ReviewCommentChangedEvent) => void): () => void;
	};
	agentInstall: {
		listProviders(): Promise<{
			providers: Array<{
				id: "claude-code" | "codex";
				displayName: string;
				cliAvailable: boolean;
				configRootDetected: boolean;
				installed: boolean;
				cliPath: string | null;
				cliSource: "override" | "path" | "fixed" | "shell" | "none";
			}>;
			mcp: { port: number | null; bindError: string | null };
		}>;
		install(ids: ("claude-code" | "codex")[]): Promise<{
			results: Array<{
				id: "claude-code" | "codex";
				ok: boolean;
				message: string | null;
			}>;
		}>;
		uninstall(ids: ("claude-code" | "codex")[]): Promise<{
			results: Array<{
				id: "claude-code" | "codex";
				ok: boolean;
				message: string | null;
			}>;
		}>;
		pickCliPath(id: "claude-code" | "codex"): Promise<{
			canceled: boolean;
			path: string | null;
		}>;
		setCliOverride(
			id: "claude-code" | "codex",
			path: string | null,
		): Promise<{
			providers: Array<{
				id: "claude-code" | "codex";
				displayName: string;
				cliAvailable: boolean;
				configRootDetected: boolean;
				installed: boolean;
				cliPath: string | null;
				cliSource: "override" | "path" | "fixed" | "shell" | "none";
			}>;
			mcp: { port: number | null; bindError: string | null };
		}>;
	};
	noteBridge: {
		onRequest(handler: (req: NoteBridgeRequest) => void): () => void;
		sendReply(reply: NoteBridgeReply): void;
		sendReady(): void;
		sendGoodbye(): void;
	};
	agentAttentionBridge: {
		onRequest(handler: (req: AgentAttentionBridgeRequest) => void): () => void;
		sendReply(reply: AgentAttentionBridgeReply): void;
		sendReady(): void;
		sendGoodbye(): void;
	};
	events: {
		onOpenInstallModal(handler: () => void): () => void;
		onSetTheme(
			handler: (mode: "system" | "light" | "dark" | "warm") => void,
		): () => void;
	};
	app: {
		setEditorDirty(args: {
			workspaceId: string;
			worktreeId: string;
			relativePath: string;
			dirty: boolean;
		}): void;
		confirmClose(args: { proceed: boolean }): void;
		onRequestClose(handler: (req: { keys: string[] }) => void): () => void;
	};
	codeNav: {
		findDefinitions(args: {
			workspaceId: string;
			worktreeId: string;
			name: string;
			callerFile?: string;
		}): Promise<DefinitionRowPayload[]>;
		findCallees(args: {
			workspaceId: string;
			worktreeId: string;
			fnId: number;
		}): Promise<DefinitionRowPayload[]>;
		findCallers(args: {
			workspaceId: string;
			worktreeId: string;
			fnId: number;
		}): Promise<DefinitionRowPayload[]>;
		searchSymbols(args: {
			workspaceId: string;
			worktreeId: string;
			query: string;
			limit?: number;
		}): Promise<DefinitionRowPayload[]>;
		getFileImports(args: {
			workspaceId: string;
			worktreeId: string;
			file: string;
		}): Promise<string[]>;
		getWorktreeStatus(args: {
			workspaceId: string;
			worktreeId: string;
		}): Promise<WorktreeStatusPayload>;
		listFiles(args: {
			workspaceId: string;
			worktreeId: string;
		}): Promise<string[]>;
		refreshWorktree(args: {
			workspaceId: string;
			worktreeId: string;
			changedFiles?: string[];
		}): Promise<void>;
		watchWorktree(args: {
			workspaceId: string;
			worktreeId: string;
		}): Promise<void>;
		unwatchWorktree(args: {
			workspaceId: string;
			worktreeId: string;
		}): Promise<void>;
		onWorktreeIndexRefreshed(
			handler: (e: { workspaceId: string; worktreeId: string }) => void,
		): () => void;
	};
};

// ---------- code-nav ----------

const worktreeIdentShape = {
	workspaceId: z.string().min(1),
	worktreeId: z.string().min(1),
};

export const FindDefinitionsSchema = z
	.object({
		...worktreeIdentShape,
		name: z.string().min(1).max(256),
		callerFile: z.string().max(1024).optional(),
	})
	.strict();

export const FindCalleesSchema = z
	.object({ ...worktreeIdentShape, fnId: z.number().int().nonnegative() })
	.strict();
export const FindCallersSchema = z
	.object({ ...worktreeIdentShape, fnId: z.number().int().nonnegative() })
	.strict();

export const SearchSymbolsSchema = z
	.object({
		...worktreeIdentShape,
		query: z.string().max(256),
		limit: z.number().int().min(1).max(200).default(50),
	})
	.strict();

export const GetFileImportsSchema = z
	.object({
		...worktreeIdentShape,
		file: z.string().min(1).max(1024),
	})
	.strict();

export const RefreshWorktreeSchema = z
	.object({
		...worktreeIdentShape,
		changedFiles: z.array(z.string().max(1024)).optional(),
	})
	.strict();

export const WatchWorktreeSchema = z
	.object({ ...worktreeIdentShape })
	.strict();
export const UnwatchWorktreeSchema = z
	.object({ ...worktreeIdentShape })
	.strict();
export const ListFilesNavSchema = z
	.object({ ...worktreeIdentShape })
	.strict();
export const GetWorktreeStatusSchema = z
	.object({ ...worktreeIdentShape })
	.strict();

export const DefinitionRowSchema = z.object({
	id: z.number().int(),
	qualified_name: z.string(),
	bare_name: z.string(),
	file: z.string(),
	line: z.number().int(),
	exported: z.number().int(),
	is_default: z.number().int(),
	is_declaration_only: z.number().int(),
	col: z.number().int().nullable(),
	end_line: z.number().int().nullable(),
	end_col: z.number().int().nullable(),
});
export type DefinitionRowPayload = z.infer<typeof DefinitionRowSchema>;

export const WorktreeStatusSchema = z.object({
	ready: z.boolean(),
	dirtyAtIndex: z.boolean(),
	sourceFingerprint: z.string().nullable(),
	sourceIndexedAt: z.string().nullable(),
});
export type WorktreeStatusPayload = z.infer<typeof WorktreeStatusSchema>;
