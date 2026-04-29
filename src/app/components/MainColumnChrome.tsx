import type { MutableRefObject } from "react";
import type { UpdateInfo } from "../../../shared/contracts/commands";
import type { GitChangeStatus } from "../../../shared/models/git-change";
import type { GitSummary } from "../../../shared/models/git-summary";
import type { Worktree } from "../../../shared/models/worktree";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import { FilesOverlay } from "../../features/files/FilesOverlay";
import { ShortcutsHelp } from "../../features/shortcuts/ShortcutsHelp";
import { UpdateBanner } from "../../features/updater/UpdateBanner";
import { NoteSheet } from "../../features/workspace/components/NoteSheet";
import { SessionChipBar } from "../../features/workspace/components/SessionChipBar";
import { displayTitle } from "../../features/workspace/logic/session-display-title";
import type { WorkspaceAction } from "../../features/workspace/logic/workspace-state";
import type { useReviewDrawerAutoExpand } from "../../features/review/hooks/use-review-drawer-auto-expand";
import { isEditable } from "../../../shared/editor/editable-files";
import type { Platform } from "../shortcut-registry";

type AutoExpand = ReturnType<typeof useReviewDrawerAutoExpand>;

type PendingRename = {
	workspaceId: string;
	worktreeId: string;
};

type Props = {
	bannerInfo: UpdateInfo | null;
	updateInfoVersion: string | null;
	setUpdateDismissedFor: (next: string | null) => void;
	onOpenExternal: (url: string) => void;

	chipBarRef: MutableRefObject<HTMLDivElement | null>;
	activeWorktree: Worktree | null;
	activeSession: WorktreeSession | null;
	activeSummary: GitSummary | null;
	changedFileCount: number;
	activeWorkspaceId: string | null;
	setSidebarCollapsed: (next: boolean | ((prev: boolean) => boolean)) => void;
	setPendingRename: (next: PendingRename | null) => void;
	autoExpand: AutoExpand;
	dispatch: (action: WorkspaceAction) => void;

	noteSheetOpen: boolean;
	setNoteSheetOpen: (next: boolean | ((prev: boolean) => boolean)) => void;

	filesOverlayOpen: boolean;
	setFilesOverlayOpen: (next: boolean) => void;
	trackedFilesLoader: () => Promise<string[]>;
	gitStatusMap: Map<string, GitChangeStatus>;
	openEditorForFile: (path: string) => Promise<void> | void;

	shortcutsHelpOpen: boolean;
	setShortcutsHelpOpen: (next: boolean) => void;
	appPlatform: Platform;
};

/**
 * UpdateBanner + SessionChipBar + NoteSheet + FilesOverlay + ShortcutsHelp.
 * The "chrome" widgets at the top of the main column. Owns no state of its
 * own; visibility/setters are passed down from App.tsx.
 */
export function MainColumnChrome(props: Props): React.ReactElement {
	const {
		bannerInfo,
		updateInfoVersion,
		setUpdateDismissedFor,
		onOpenExternal,
		chipBarRef,
		activeWorktree,
		activeSession,
		activeSummary,
		changedFileCount,
		activeWorkspaceId,
		setSidebarCollapsed,
		setPendingRename,
		autoExpand,
		dispatch,
		noteSheetOpen,
		setNoteSheetOpen,
		filesOverlayOpen,
		setFilesOverlayOpen,
		trackedFilesLoader,
		gitStatusMap,
		openEditorForFile,
		shortcutsHelpOpen,
		setShortcutsHelpOpen,
		appPlatform,
	} = props;

	return (
		<>
			<UpdateBanner
				info={bannerInfo}
				onDownload={(url) => onOpenExternal(url)}
				onDismiss={() => setUpdateDismissedFor(updateInfoVersion)}
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
							autoExpand.noteUserExpand(activeWorktree.id);
							dispatch({
								type: "session/setReviewDrawerOpen",
								worktreeId: activeWorktree.id,
								open: true,
							});
							dispatch({
								type: "session/setReviewMode",
								worktreeId: activeWorktree.id,
								reviewMode: "changes",
							});
						}}
						onFilesClick={() => setFilesOverlayOpen(true)}
						onNoteClick={() => setNoteSheetOpen((prev) => !prev)}
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
				onViewFile={(path) => {
					if (!activeWorktree) {
						setFilesOverlayOpen(false);
						return;
					}
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
					dispatch({
						type: "session/setReviewDrawerOpen",
						worktreeId: activeWorktree.id,
						open: true,
					});
					autoExpand.noteUserExpand(activeWorktree.id);
					setFilesOverlayOpen(false);
				}}
				onEditFile={(path) => {
					setFilesOverlayOpen(false);
					void openEditorForFile(path);
				}}
				isEditable={isEditable}
			/>
			<ShortcutsHelp
				open={shortcutsHelpOpen}
				platform={appPlatform}
				onClose={() => setShortcutsHelpOpen(false)}
			/>
		</>
	);
}
