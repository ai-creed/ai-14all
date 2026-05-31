import type { MutableRefObject } from "react";
import type { GitSummary } from "../../../shared/models/git-summary";
import type { Worktree } from "../../../shared/models/worktree";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import { SessionChipBar } from "../../features/workspace/components/SessionChipBar";
import { UsageStrip } from "../../features/telemetry/UsageStrip";
import { useUsageSnapshot } from "../../features/telemetry/use-usage-snapshot";
import { displayTitle } from "../../features/workspace/logic/session-display-title";
import type { WorkspaceAction } from "../../features/workspace/logic/workspace-state";
import type { Platform } from "../shortcut-registry";
import type { PendingRename } from "./SidebarPanel";

// Clears the macOS traffic-light cluster (see electron/main/windows.ts
// trafficLightPosition). Non-mac keeps the default 8px (px-2) left padding.
const MACOS_TRAFFIC_LIGHT_INSET_PX = 78;
const DEFAULT_BAR_PADDING_LEFT_PX = 8;

type Props = {
	chipBarRef: MutableRefObject<HTMLDivElement | null>;
	activeWorktree: Worktree | null;
	activeSession: WorktreeSession | null;
	activeSummary: GitSummary | null;
	changedFileCount: number;
	activeWorkspaceId: string | null;
	appPlatform: Platform;
	openWorktreePaths: string[];
	setSidebarCollapsed: (next: boolean | ((prev: boolean) => boolean)) => void;
	setPendingRename: (next: PendingRename | null) => void;
	setFilesOverlayOpen: (next: boolean) => void;
	setNoteSheetOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
	openReview: () => void;
	dispatch: (action: WorkspaceAction) => void;
	/** Terminal action chips (+ Shell / Layout / Presets) for the chip bar's right group. */
	terminalActions?: React.ReactNode;
};

// -webkit-app-region is non-standard; React's CSS types don't include it.
const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function AppBar(props: Props): React.ReactElement {
	const {
		chipBarRef,
		activeWorktree,
		activeSession,
		activeSummary,
		changedFileCount,
		activeWorkspaceId,
		appPlatform,
		openWorktreePaths,
		setSidebarCollapsed,
		setPendingRename,
		setFilesOverlayOpen,
		setNoteSheetOpen,
		openReview,
		dispatch,
		terminalActions,
	} = props;

	const usageSnapshot = useUsageSnapshot();
	const leftInset =
		appPlatform === "mac"
			? MACOS_TRAFFIC_LIGHT_INSET_PX
			: DEFAULT_BAR_PADDING_LEFT_PX;

	return (
		<header
			data-testid="app-bar"
			className="flex items-center h-10 shrink-0 border-b border-border bg-card px-2"
			style={{ ...DRAG, paddingLeft: leftInset }}
		>
			{activeWorktree && activeSession ? (
				<div ref={chipBarRef} className="flex-1 min-w-0" style={NO_DRAG}>
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
						terminalActions={terminalActions}
						usage={
							<UsageStrip
								snapshot={usageSnapshot}
								currentWorktreePath={activeWorktree.path}
								openWorktreePaths={openWorktreePaths}
							/>
						}
					/>
				</div>
			) : (
				<span
					className="text-sm font-semibold text-muted-foreground"
					style={NO_DRAG}
				>
					ai-14all
				</span>
			)}
		</header>
	);
}
