import type { ProcessSession } from "../../../shared/models/process-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type { Worktree } from "../../../shared/models/worktree";
import type {
	WorkspaceAction,
	WorkspaceState,
} from "../../features/workspace/logic/workspace-state";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import { TerminalTabs } from "../../features/terminals/components/TerminalTabs";
import { TerminalPane } from "../../features/terminals/components/TerminalPane";
import { normalizeTerminalTitle } from "../normalize-terminal-title";

type Props = {
	workspaceState: WorkspaceState;
	activeWorktree: Worktree | null;
	activeSession: WorktreeSession | null;
	activeProcesses: ProcessSession[];
	visibleProcessIds: readonly string[];
	sessions: TerminalSession[];
	orderedSessions: TerminalSession[];
	dispatch: (action: WorkspaceAction) => void;
	handleAddAdHoc: () => Promise<void>;
	selectActiveProcess: (processId: string) => void;
	handleLaunchPreset: (presetId: string) => Promise<void>;
	handleCloseProcess: (processId: string) => Promise<void>;
	handleStopProcess: (processId: string) => Promise<void>;
	handleRestartProcess: (processId: string) => Promise<void>;
	openPresetManager: () => void;
	findProcessByTerminalSessionId: (
		terminalSessionId: string,
	) => { process: ProcessSession; workspaceId: string } | null;
};

/**
 * Bottom terminal panel: tabs + the active xterm pane(s). Owns no state of
 * its own; tab + layout state lives on the active session and is mutated by
 * dispatched workspace actions passed in via props.
 */
export function TerminalPanel(props: Props): React.ReactElement | null {
	const {
		workspaceState,
		activeWorktree,
		activeSession,
		activeProcesses,
		visibleProcessIds,
		sessions,
		orderedSessions,
		dispatch,
		handleAddAdHoc,
		selectActiveProcess,
		handleLaunchPreset,
		handleCloseProcess,
		handleStopProcess,
		handleRestartProcess,
		openPresetManager,
		findProcessByTerminalSessionId,
	} = props;

	if (!workspaceState.selectedWorktreeId) return null;

	return (
		<section className="shell-panel shell-terminal-section">
			<TerminalTabs
				processes={activeProcesses.map((p) => ({
					id: p.id,
					label: p.label,
					status: p.status,
					pinned: p.pinned,
					attentionState: p.attentionState,
					exitCode: p.exitCode,
					lastActivityAt: p.lastActivityAt,
				}))}
				activeProcessId={activeSession?.activeProcessSessionId ?? null}
				presets={workspaceState.commandPresets}
				layoutMode={activeSession?.terminalLayoutMode ?? "single"}
				splitLeftProcessId={activeSession?.splitLeftProcessId ?? null}
				splitRightProcessId={activeSession?.splitRightProcessId ?? null}
				onAddAdHoc={handleAddAdHoc}
				onSelect={selectActiveProcess}
				onLaunchPreset={handleLaunchPreset}
				onOpenPresetManager={openPresetManager}
				onClose={handleCloseProcess}
				onStop={handleStopProcess}
				onRestart={handleRestartProcess}
				onTogglePinned={(processId) =>
					dispatch({
						type: "session/toggleProcessPinned",
						processId,
					})
				}
				onToggleSplitMode={() =>
					dispatch({
						type: "session/setTerminalLayoutMode",
						worktreeId: activeWorktree!.id,
						layoutMode:
							activeSession?.terminalLayoutMode === "split"
								? "single"
								: "split",
						autoAssignProcessIds:
							activeSession?.terminalLayoutMode === "single" &&
							!activeSession.splitLeftProcessId &&
							!activeSession.splitRightProcessId &&
							activeProcesses.length === 2
								? activeProcesses.map((process) => process.id)
								: undefined,
					})
				}
				onShowInSplit={(processId, slot) =>
					dispatch({
						type: "session/assignProcessToSplitSlot",
						worktreeId: activeWorktree!.id,
						processId,
						slot,
					})
				}
				onRemoveFromSplit={(processId) =>
					dispatch({
						type: "session/removeProcessFromSplit",
						worktreeId: activeWorktree!.id,
						processId,
					})
				}
			/>

			<div
				className={
					activeSession?.terminalLayoutMode === "split"
						? "shell-terminal-panel__body shell-terminal-panel__body--split"
						: "shell-terminal-panel__body"
				}
			>
				{orderedSessions.map((session) => {
					const process =
						findProcessByTerminalSessionId(session.id)?.process ?? null;
					return (
						<TerminalPane
							key={session.id}
							session={session}
							visible={
								session.worktreeId === activeWorktree?.id &&
								visibleProcessIds.some(
									(processId) =>
										workspaceState.processSessionsById[processId]
											?.terminalSessionId === session.id,
								)
							}
							onTitleChange={(title) => {
								if (!process || process.origin !== "adHoc") return;
								const nextLabel = normalizeTerminalTitle(title);
								if (!nextLabel) return;
								dispatch({
									type: "session/updateProcessLabel",
									processId: process.id,
									label: nextLabel,
								});
							}}
							onActivate={() => {
								if (!process || process.worktreeId !== activeWorktree?.id)
									return;
								selectActiveProcess(process.id);
							}}
						/>
					);
				})}

				{activeSession?.terminalLayoutMode === "split" ? (
					<>
						{!activeSession.splitLeftProcessId && (
							<div
								className="shell-terminal-split__empty"
								data-slot="left"
								onMouseDown={() => undefined}
							>
								<p className="shell-empty-state">
									No shell assigned to this split pane. Use a tab menu to show
									one here.
								</p>
							</div>
						)}
						{!activeSession.splitRightProcessId && (
							<div
								className="shell-terminal-split__empty"
								data-slot="right"
								onMouseDown={() => undefined}
							>
								<p className="shell-empty-state">
									No shell assigned to this split pane. Use a tab menu to show
									one here.
								</p>
							</div>
						)}
					</>
				) : !sessions.some((session) => {
						const activeProcess = activeSession?.activeProcessSessionId
							? workspaceState.processSessionsById[
									activeSession.activeProcessSessionId
								]
							: null;
						return (
							session.worktreeId === activeWorktree?.id &&
							session.id === activeProcess?.terminalSessionId
						);
				  }) ? (
					<div className="shell-terminal-panel__empty">
						<p className="shell-empty-state">
							No active shell selected. Open or choose a shell to continue.
						</p>
					</div>
				) : null}
			</div>
		</section>
	);
}
