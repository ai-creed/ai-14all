import type { MutableRefObject } from "react";
import { Icon } from "@/components/ui/icon";
import type { UpdateInfo } from "../../../shared/contracts/commands";
import type { GitChangeStatus } from "../../../shared/models/git-change";
import type { GitSummary } from "../../../shared/models/git-summary";
import type { Worktree } from "../../../shared/models/worktree";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import { FilesOverlay } from "../../features/files/FilesOverlay";
import {
	hasInlineEditorsRegistered,
	runInlineEditorDirtyGate,
} from "../../features/viewer/inline-editor-registry";
import { ShortcutsHelp } from "../../features/shortcuts/ShortcutsHelp";
import { UpdateBanner } from "../../features/updater/UpdateBanner";
import { NoteSheet } from "../../features/workspace/components/NoteSheet";
import { SessionChipBar } from "../../features/workspace/components/SessionChipBar";
import { UsageStrip } from "../../features/telemetry/UsageStrip";
import { useUsageSnapshot } from "../../features/telemetry/use-usage-snapshot";
import { displayTitle } from "../../features/workspace/logic/session-display-title";
import type { WorkspaceAction } from "../../features/workspace/logic/workspace-state";
import type { Platform } from "../shortcut-registry";

type PendingRename = {
	workspaceId: string;
	worktreeId: string;
};

type Props = {
	downloadingBannerInfo: UpdateInfo | null;
	downloadedBannerInfo: UpdateInfo | null;
	onRestartUpdate: () => void;
	onLaterUpdate: () => void;

	chipBarRef: MutableRefObject<HTMLDivElement | null>;
	activeWorktree: Worktree | null;
	activeSession: WorktreeSession | null;
	activeSummary: GitSummary | null;
	changedFileCount: number;
	activeWorkspaceId: string | null;
	setSidebarCollapsed: (next: boolean | ((prev: boolean) => boolean)) => void;
	setPendingRename: (next: PendingRename | null) => void;
	openReview: () => void;
	dispatch: (action: WorkspaceAction) => void;

	noteSheetOpen: boolean;
	setNoteSheetOpen: (next: boolean | ((prev: boolean) => boolean)) => void;

	filesOverlayOpen: boolean;
	setFilesOverlayOpen: (next: boolean) => void;
	trackedFilesLoader: (opts: { includeIgnored: boolean }) => Promise<string[]>;
	gitStatusMap: Map<string, GitChangeStatus>;

	shortcutsHelpOpen: boolean;
	setShortcutsHelpOpen: (next: boolean) => void;
	appPlatform: Platform;

	/** Paths of worktrees currently open in the app (telemetry "Active" scope). */
	openWorktreePaths: string[];

	/** Opens the global Plugins panel. Wired to a button beside the usage strip. */
	onOpenPlugins: () => void;
	/** Opens the Phone Bridge settings panel. Wired beside the Plugins button. */
	onOpenPhoneBridge: () => void;
};

/**
 * UpdateBanner + SessionChipBar + NoteSheet + FilesOverlay + ShortcutsHelp.
 * The "chrome" widgets at the top of the main column. Owns no state of its
 * own; visibility/setters are passed down from App.tsx.
 */
export function MainColumnChrome(props: Props): React.ReactElement {
	const {
		downloadingBannerInfo,
		downloadedBannerInfo,
		onRestartUpdate,
		onLaterUpdate,
		chipBarRef,
		activeWorktree,
		activeSession,
		activeSummary,
		changedFileCount,
		activeWorkspaceId,
		setSidebarCollapsed,
		setPendingRename,
		openReview,
		dispatch,
		noteSheetOpen,
		setNoteSheetOpen,
		filesOverlayOpen,
		setFilesOverlayOpen,
		trackedFilesLoader,
		gitStatusMap,
		shortcutsHelpOpen,
		setShortcutsHelpOpen,
		appPlatform,
		openWorktreePaths,
		onOpenPlugins,
		onOpenPhoneBridge,
	} = props;

	const usageSnapshot = useUsageSnapshot();

	return (
		<>
			<UpdateBanner
				downloadingInfo={downloadingBannerInfo}
				downloadedInfo={downloadedBannerInfo}
				onRestart={onRestartUpdate}
				onLater={onLaterUpdate}
			/>
			{activeWorktree && activeSession && (
				<div ref={chipBarRef}>
					<SessionChipBar
						sessionTitle={displayTitle(activeSession.title, activeWorktree)}
						worktreeLabel={activeWorktree.label}
						branchName={activeWorktree.branchName}
						isDirty={activeSummary?.isDirty ?? false}
						changedFileCount={changedFileCount}
						noteNonEmpty={activeSession.note.trim() !== ""}
						onRenameClick={() => {
							if (activeWorkspaceId !== null && activeWorktree !== null) {
								setSidebarCollapsed(false);
								setPendingRename({
									workspaceId: activeWorkspaceId,
									worktreeId: activeWorktree.id,
								});
							}
						}}
						onDirtyClick={() => {
							if (!activeWorktree) return;
							dispatch({
								type: "session/setReviewMode",
								worktreeId: activeWorktree.id,
								reviewMode: "changes",
							});
							openReview();
						}}
						onFilesClick={() => setFilesOverlayOpen(true)}
						onNoteClick={() => setNoteSheetOpen((prev) => !prev)}
						usage={
							<UsageStrip
								snapshot={usageSnapshot}
								currentWorktreePath={activeWorktree.path}
								openWorktreePaths={openWorktreePaths}
							/>
						}
						plugins={
							<>
								<button
									type="button"
									className="shell-chip-bar__action plugins-entry-button"
									aria-label="Open Plugins panel"
									onClick={onOpenPlugins}
								>
									<span
										className="shell-chip-bar__action-icon"
										aria-hidden="true"
									>
										<Icon name="plugins" />
									</span>
									Plugins
								</button>
								<button
									type="button"
									className="shell-chip-bar__action phone-bridge-entry-button"
									aria-label="Open Phone Bridge panel"
									onClick={onOpenPhoneBridge}
								>
									Phone Bridge
								</button>
							</>
						}
					/>
				</div>
			)}
			<NoteSheet
				open={noteSheetOpen}
				note={activeSession?.note ?? ""}
				onNoteChange={(note) => {
					if (activeWorktree) {
						dispatch({
							type: "session/setNote",
							worktreeId: activeWorktree.id,
							note,
						});
					}
				}}
				onClose={() => setNoteSheetOpen(false)}
			/>
			<FilesOverlay
				isOpen={filesOverlayOpen}
				onClose={() => setFilesOverlayOpen(false)}
				trackedFilesLoader={trackedFilesLoader}
				gitStatusMap={gitStatusMap}
				showGitignored={activeSession?.treeShowIgnored ?? false}
				onToggleShowGitignored={() => {
					if (!activeWorktree) return;
					dispatch({
						type: "session/setTreeShowIgnored",
						worktreeId: activeWorktree.id,
						showIgnored: !(activeSession?.treeShowIgnored ?? false),
					});
				}}
				onOpenFile={(path) => {
					if (!activeWorktree) {
						setFilesOverlayOpen(false);
						return;
					}
					const proceed = () => {
						dispatch({
							type: "session/selectFile",
							worktreeId: activeWorktree.id,
							relativePath: path,
						});
						dispatch({
							type: "session/setReviewMode",
							worktreeId: activeWorktree.id,
							reviewMode: "files",
						});
						openReview();
						setFilesOverlayOpen(false);
					};
					// Skip the async gate when no editor is mounted so React keeps
					// the dispatches in the synchronous event-handler batch.
					if (!hasInlineEditorsRegistered()) {
						proceed();
						return;
					}
					void (async () => {
						const gate = await runInlineEditorDirtyGate();
						if (gate === "cancel") return;
						proceed();
					})();
				}}
			/>
			<ShortcutsHelp
				open={shortcutsHelpOpen}
				platform={appPlatform}
				onClose={() => setShortcutsHelpOpen(false)}
			/>
		</>
	);
}
