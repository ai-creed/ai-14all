import type { UpdateInfo } from "../../../shared/contracts/commands";
import type { GitChangeStatus } from "../../../shared/models/git-change";
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
import type { WorkspaceAction } from "../../features/workspace/logic/workspace-state";
import type { Platform } from "../shortcut-registry";

type Props = {
	downloadingBannerInfo: UpdateInfo | null;
	downloadedBannerInfo: UpdateInfo | null;
	onRestartUpdate: () => void;
	onLaterUpdate: () => void;

	activeWorktree: Worktree | null;
	activeSession: WorktreeSession | null;
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
};

/**
 * UpdateBanner + NoteSheet + FilesOverlay + ShortcutsHelp.
 * The "chrome" widgets at the top of the main column. Owns no state of its
 * own; visibility/setters are passed down from App.tsx.
 */
export function MainColumnChrome(props: Props): React.ReactElement {
	const {
		downloadingBannerInfo,
		downloadedBannerInfo,
		onRestartUpdate,
		onLaterUpdate,
		activeWorktree,
		activeSession,
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
	} = props;

	return (
		<>
			<UpdateBanner
				downloadingInfo={downloadingBannerInfo}
				downloadedInfo={downloadedBannerInfo}
				onRestart={onRestartUpdate}
				onLater={onLaterUpdate}
			/>
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
