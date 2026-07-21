import { z } from "zod";
import type { ProviderId } from "./agent-install.js";
import type { AgentProviderId } from "../models/agent-provider.js";
import type { Repository } from "../models/repository.js";
import type { Worktree } from "../models/worktree.js";
import type { TerminalSession } from "../models/terminal-session.js";
import type { FileReadResult } from "../models/file-view.js";
import type { ImageReadResult } from "../models/image-view.js";
import type {
	TerminalOutputEvent,
	TerminalExitEvent,
	TerminalStateEvent,
	TerminalErrorEvent,
	TerminalWatchStateEvent,
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
import {
	SettingsPatchSchema,
	type PersistedSettingsV1,
	type SettingsPatch,
} from "../models/persisted-settings.js";
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
import type {
	AgentResumeBridgeReply,
	AgentResumeBridgeRequest,
} from "./agent-resume-bridge.js";
import type { PluginsApi } from "./plugins.js";

// --- Zod schemas for command payloads ---

export const PickRepositoryRootSchema = z.object({});

export const OpenRepositoryWorkspaceSchema = z.object({ path: z.string() });

export const ListWorktreesSchema = z.object({ workspaceId: z.string() });

export const CreateWorktreeSchema = z.object({
	workspaceId: z.string(),
	name: z.string(),
	baseBranch: z.string().optional(),
});

export const RemoveWorktreeSchema = z.object({
	workspaceId: z.string(),
	worktreeId: z.string(),
});

export const PreviewCreateWorktreeSchema = z.object({
	workspaceId: z.string(),
	name: z.string(),
	baseBranch: z.string().optional(),
});

export const PreviewRemoveWorktreeSchema = z.object({
	workspaceId: z.string(),
	worktreeId: z.string(),
});

export const ListRemoteBranchesSchema = z.object({ workspaceId: z.string() });

export const RefreshRemoteSchema = z.object({ workspaceId: z.string() });

export type RemoteBranchList = {
	branches: string[];
	defaultBranch: string;
};

export type RefreshRemoteResult = {
	ok: boolean;
	error?: string;
};

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

// AgentPtyUpsert's canonical shape lives in
// services/pty-inspect/agent-pty-catalog.ts; `shared/` must not import from
// `services/` (same rationale as DiagnosticsAttentionLogEvent above), so the
// renderer-facing schema is mirrored here — fields must stay in exact sync.
export const AgentPtyUpsertSchema = z.object({
	worktreeId: z.string(),
	agentId: z.string(),
	terminalSessionId: z.string().nullable(),
	// Mirrors AgentProvider (shared/models/agent-attention.ts); keep in sync when
	// new providers are added.
	provider: z
		.enum(["claude", "codex", "ezio", "cursor", "antigravity", "other"])
		.nullable(),
	label: z.string(),
	live: z.boolean(),
	agentDetected: z.boolean(),
});
export type AgentPtyUpsert = z.infer<typeof AgentPtyUpsertSchema>;

export const AgentPtyRefSchema = z.object({
	worktreeId: z.string(),
	agentId: z.string(),
});
export type AgentPtyRef = z.infer<typeof AgentPtyRefSchema>;

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

type AttentionLogProvider = AgentProviderId | "other" | null;

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
			type: "mcp_resume_rejected";
			ts: number;
			worktreeId: string;
			// Raw free-text provider the agent reported (NOT the constrained
			// `AttentionLogProvider` enum). Mirrors `MCPResumeRejectedLogEvent` in
			// services/diagnostics/agent-attention-logger.ts.
			provider: string;
			reason: string;
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

export const WriteSettingsSchema = z.object({
	patch: SettingsPatchSchema.strict(),
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

export interface PhoneBridgeStatus {
	enabled: boolean;
	listening: boolean;
	addr: string | null;
	port: number | null;
	paired: boolean;
	sas: string | null;
	pairing: "idle" | "awaiting-scan" | "awaiting-sas";
	offer: string | null;
	offerExpiresAt: number | null;
	pairedAt: number | null;
	grantedPermissions: string[] | null;
	lastError: string | null;
}

// --- The API surface exposed to the renderer via the preload bridge ---

export type Ai14AllDesktopApi = {
	repository: {
		pickRoot(): Promise<string | null>;
		listWorktrees(workspaceId: string): Promise<Worktree[]>;
		previewCreateWorktree(
			workspaceId: string,
			name: string,
			baseBranch?: string,
		): Promise<CreateWorktreePreview>;
		createWorktree(
			workspaceId: string,
			name: string,
			baseBranch?: string,
		): Promise<Worktree>;
		previewRemoveWorktree(
			workspaceId: string,
			worktreeId: string,
		): Promise<RemoveWorktreePreview>;
		removeWorktree(workspaceId: string, worktreeId: string): Promise<void>;
		listRemoteBranches(workspaceId: string): Promise<RemoteBranchList>;
		refreshRemote(workspaceId: string): Promise<RefreshRemoteResult>;
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
		onWatchState(
			listener: (event: TerminalWatchStateEvent) => void,
		): () => void;
		notifyBlur(sessionId: string): Promise<void>;
		getWatchState(sessionId: string): Promise<TerminalWatchStateEvent | null>;
	};
	agentPtys: {
		upsert(msg: AgentPtyUpsert): Promise<void>;
		remove(worktreeId: string, agentId: string): Promise<void>;
		rebindIntent(worktreeId: string, agentId: string): Promise<void>;
		rebindCancel(worktreeId: string, agentId: string): Promise<void>;
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
		readImage(
			workspaceId: string,
			worktreeId: string,
			relativePath: string,
		): Promise<ImageReadResult>;
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
	settings: {
		initial: PersistedSettingsV1;
		// Captured once from the preload's sendSync settings:readSync call — the
		// only point that can observe firstRun: true (see preload/index.ts). The
		// async read() below always reports firstRun: false because the sendSync
		// call above already seeds the file first.
		initialFirstRun: boolean;
		read(): Promise<{ settings: PersistedSettingsV1; firstRun: boolean }>;
		write(patch: SettingsPatch): Promise<PersistedSettingsV1>;
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
		setIncludeUntracked(includeUntracked: boolean): Promise<void>;
		setChipRange(range: "week" | "month"): Promise<void>;
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
		restore(
			comment: ReviewComment,
		): Promise<{ ok: true } | { ok: false; error: "already_exists" }>;
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
				id: ProviderId;
				displayName: string;
				cliAvailable: boolean;
				configRootDetected: boolean;
				installed: boolean;
				cliPath: string | null;
				cliSource: "override" | "path" | "fixed" | "shell" | "none";
			}>;
			mcp: { port: number | null; bindError: string | null };
		}>;
		install(ids: ProviderId[]): Promise<{
			results: Array<{
				id: ProviderId;
				ok: boolean;
				message: string | null;
			}>;
		}>;
		uninstall(ids: ProviderId[]): Promise<{
			results: Array<{
				id: ProviderId;
				ok: boolean;
				message: string | null;
			}>;
		}>;
		pickCliPath(id: ProviderId): Promise<{
			canceled: boolean;
			path: string | null;
		}>;
		setCliOverride(
			id: ProviderId,
			path: string | null,
		): Promise<{
			providers: Array<{
				id: ProviderId;
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
	plugins: PluginsApi;
	events: {
		onOpenInstallModal(handler: () => void): () => void;
		onSetTheme(
			handler: (mode: "system" | "light" | "dark" | "warm" | "tui") => void,
		): () => void;
		// Optional: implemented by the real preload bridge; the hook consuming
		// this handles absence gracefully so non-Electron contexts (unit tests,
		// future non-desktop shells) do not need a stub.
		onAdjustTerminalFontSize?(
			handler: (action: "increase" | "decrease" | "reset") => void,
		): () => void;
		// Optional: implemented by the real preload bridge; the onboarding hook
		// optional-chains these, so non-Electron contexts need no stub.
		onShowWelcomeTour?(handler: () => void): () => void;
		onResetOnboardingHints?(handler: () => void): () => void;
		onSettingsChanged(cb: (settings: PersistedSettingsV1) => void): () => void;
		// Agent conversation-resume bridge (main → renderer request/ack). Optional:
		// the real preload bridge implements these; the consuming hook
		// optional-chains them so non-Electron contexts (unit tests, future
		// non-desktop shells) need no stub.
		onAgentResumeRequest?(
			handler: (req: AgentResumeBridgeRequest) => void,
		): () => void;
		sendAgentResumeReply?(reply: AgentResumeBridgeReply): void;
		sendAgentResumeReady?(): void;
		sendAgentResumeGoodbye?(): void;
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
		onWorktreeUnavailable(
			handler: (e: {
				workspaceId: string;
				worktreeId: string;
				reason: "no-cortex" | "unsupported-schema";
			}) => void,
		): () => void;
		onAvailabilityChanged(handler: () => void): () => void;
	};
	phoneBridge: {
		status(): Promise<PhoneBridgeStatus | undefined>;
		setEnabled(enabled: boolean): Promise<PhoneBridgeStatus | undefined>;
		startPairing(): Promise<{ offer: string | null }>;
		confirmSas(ok: boolean): Promise<boolean>;
		cancelPairing(): Promise<PhoneBridgeStatus | undefined>;
		forget(): Promise<PhoneBridgeStatus | undefined>;
		onStatusChanged(handler: (status: PhoneBridgeStatus) => void): () => void;
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

export const WatchWorktreeSchema = z.object({ ...worktreeIdentShape }).strict();
export const UnwatchWorktreeSchema = z
	.object({ ...worktreeIdentShape })
	.strict();
export const ListFilesNavSchema = z.object({ ...worktreeIdentShape }).strict();
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
	available: z.boolean(),
	ready: z.boolean(),
	dirtyAtIndex: z.boolean(),
	sourceFingerprint: z.string().nullable(),
	sourceIndexedAt: z.string().nullable(),
	reason: z
		.enum(["no-cortex", "unsupported-schema", "not-indexed", "cortex-disabled"])
		.nullable(),
});
export type WorktreeStatusPayload = z.infer<typeof WorktreeStatusSchema>;
