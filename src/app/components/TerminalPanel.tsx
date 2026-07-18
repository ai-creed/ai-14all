import { useState } from "react";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type { Worktree } from "../../../shared/models/worktree";
import type { WorkspaceAction } from "../../features/workspace/logic/workspace-state";
import type { WorkspaceState } from "../../../shared/models/workspace-state";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import type { ITheme } from "xterm";
import type { LayoutId } from "../../../shared/models/terminal-layout";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TERMINAL_LAYOUTS } from "../../features/terminals/logic/terminal-layouts";
import { TerminalPane } from "../../features/terminals/components/TerminalPane";
import { useTerminalFontSize } from "../../features/terminals/hooks/use-terminal-font-size";
import { EmptySlotLauncher } from "../../features/terminals/components/EmptySlotLauncher";
import { ProviderLogo } from "../../features/terminals/components/ProviderLogo";
import type { AgentProvider } from "../../features/terminals/logic/agent-launch";
import { collabGlyphState } from "../../features/terminals/logic/agent-launch";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import { normalizeTerminalTitle } from "../normalize-terminal-title";
import { useSettings } from "../hooks/use-settings";

type Props = {
	/** xterm color theme matching the active app palette. */
	terminalTheme: ITheme;
	/**
	 * Whether this panel belongs to the currently-active workspace. Panels for
	 * inactive workspaces stay mounted (so their xterm instances keep buffering
	 * PTY output and never lose scrollback across a workspace switch) but are
	 * hidden via CSS; their panes are rendered with `visible={false}` so the
	 * pane's hide/show machinery saves scroll on hide and re-fits on show.
	 * Defaults to true so existing single-workspace callers are unaffected.
	 */
	panelVisible?: boolean;
	/**
	 * When true, terminal panes do not auto-grab focus (the review overlay's
	 * symbol search owns focus while it is open). Threaded to TerminalPane.
	 */
	suppressAutoFocus?: boolean;
	workspaceState: WorkspaceState;
	activeWorktree: Worktree | null;
	activeSession: WorktreeSession | null;
	sessions: TerminalSession[];
	layoutId: LayoutId;
	slotProcessIds: (string | null)[];
	terminalFocusSignal: number;
	dispatch: (action: WorkspaceAction) => void;
	selectActiveProcess: (processId: string) => void;
	onCloseSlot: (processId: string) => void;
	onRestartSlot: (processId: string) => void;
	onPromoteSlot: (slotIndex: number) => void;
	onStartShellInSlot: (slotIndex: number) => void;
	/** Detected agent providers to surface in empty slots (empty → shell only). */
	agentProviders: AgentProvider[];
	/** Launch an agent into a specific empty slot. */
	onLaunchAgentInSlot: (provider: AgentProvider, slotIndex: number) => void;
	findProcessByTerminalSessionId: (
		terminalSessionId: string,
	) => { process: ProcessSession; workspaceId: string } | null;
	/** Live whisper state for THIS panel's worktree; drives the collab glyph. */
	whisperState?: WhisperWorktreeState;
};

/**
 * Bottom terminal panel: a CSS-grid of reserved slots driven by the active
 * layout descriptor. Each non-null slot hosts one xterm pane + a slim header;
 * empty slots show a "start a shell" CTA. Layout/slot state lives on the active
 * session and is mutated via dispatched workspace actions.
 */
export function TerminalPanel(props: Props): React.ReactElement | null {
	const {
		terminalTheme,
		panelVisible = true,
		suppressAutoFocus = false,
		workspaceState,
		activeWorktree,
		activeSession,
		sessions,
		layoutId,
		slotProcessIds,
		terminalFocusSignal,
		dispatch,
		selectActiveProcess,
		onCloseSlot,
		onRestartSlot,
		onPromoteSlot,
		onStartShellInSlot,
		agentProviders,
		onLaunchAgentInSlot,
		whisperState,
	} = props;

	// Per-process refit counters; bumping one tells that slot's pane to re-fit
	// and scroll to the bottom (manual recovery for vanished shell text).
	const [fitSignals, setFitSignals] = useState<Record<string, number>>({});
	const requestRefit = (processId: string) =>
		setFitSignals((prev) => ({
			...prev,
			[processId]: (prev[processId] ?? 0) + 1,
		}));

	// Global, user-controlled, persisted terminal font size (replaces the old
	// slot-count auto-scale). Called before the early return to satisfy the
	// Rules of Hooks.
	const { fontSize: terminalFontSize } = useTerminalFontSize();

	const { settings, update } = useSettings();
	// Single dialog per panel; a second click while open retargets it (spec §5.2).
	const [pendingConfirm, setPendingConfirm] = useState<{
		kind: "restart" | "close";
		processId: string;
		label: string;
	} | null>(null);

	const invokeSlotAction = (kind: "restart" | "close", processId: string) => {
		if (kind === "restart") onRestartSlot(processId);
		else onCloseSlot(processId);
	};

	const requestSlotAction = (
		kind: "restart" | "close",
		process: ProcessSession,
	) => {
		const ask =
			kind === "restart"
				? settings.terminalConfirm.restart
				: settings.terminalConfirm.close;
		// Only a live process is destructive to kill; exited/error/restarting
		// bypass (spec §5.2 — restarting an exited pane is a respawn).
		if (process.status === "running" && ask) {
			setPendingConfirm({ kind, processId: process.id, label: process.label });
			return;
		}
		invokeSlotAction(kind, process.id);
	};

	if (!workspaceState.selectedWorktreeId) return null;

	const layout = TERMINAL_LAYOUTS[layoutId];
	const isMasterFamily =
		layout.distribution === "master" || layout.distribution === "double-master";

	return (
		<section className="shell-panel shell-terminal-section">
			<div
				className="shell-terminal-panel__grid"
				style={{
					gridTemplateColumns: layout.gridTemplateColumns,
					gridTemplateRows: layout.gridTemplateRows,
				}}
			>
				{slotProcessIds.map((processId, slotIndex) => {
					const placement = layout.slotPlacements[slotIndex];
					const cellStyle = {
						gridColumn: placement.gridColumn,
						gridRow: placement.gridRow,
					};
					if (!processId) {
						return (
							<div
								key={`empty-${slotIndex}`}
								className="shell-terminal-slot shell-terminal-slot--empty"
								style={cellStyle}
							>
								<EmptySlotLauncher
									slotIndex={slotIndex}
									providers={agentProviders}
									onLaunchAgent={onLaunchAgentInSlot}
									onStartShell={onStartShellInSlot}
								/>
							</div>
						);
					}
					const process = workspaceState.processSessionsById[processId] ?? null;
					const termSession = process?.terminalSessionId
						? (sessions.find((s) => s.id === process.terminalSessionId) ?? null)
						: null;
					const isChild = slotIndex >= layout.masterSlots;
					// Top-row slots have nothing stacked above them, so their
					// header skips the bold separator border (see shell.css).
					const isTopRow = placement.gridRow.split("/")[0].trim() === "1";
					return (
						<div
							key={processId}
							className="shell-terminal-slot"
							style={cellStyle}
							data-testid={`slot-${slotIndex}`}
							data-top-row={isTopRow ? "true" : "false"}
							data-process-id={processId}
						>
							<header className="shell-terminal-slot__header">
								{process && (
									<span
										className="shell-terminal-slot__badge"
										data-testid={`slot-badge-${slotIndex}`}
										data-attention={process.attentionState}
										data-status={process.status}
										title={`${process.status}${
											process.exitCode != null
												? ` (exit ${process.exitCode})`
												: ""
										}`}
									/>
								)}
								{process?.provider && process.provider !== "other" && (
									<ProviderLogo provider={process.provider} />
								)}
								{process &&
									(() => {
										const collab = collabGlyphState(process, whisperState);
										return collab ? (
											<span
												className="shell-terminal-slot__collab"
												title={
													collab.ready
														? `${collab.pairLabel} · ready for workflows`
														: collab.pairLabel
												}
												data-testid={`slot-collab-${slotIndex}`}
											>
												<Icon name="link" />
											</span>
										) : null;
									})()}
								<span className="shell-terminal-slot__label">
									{process?.label ?? "shell"}
								</span>
								{isMasterFamily && isChild && (
									<button
										type="button"
										aria-label="Promote to master"
										title="Promote to master"
										data-testid={`slot-promote-${slotIndex}`}
										onClick={() => onPromoteSlot(slotIndex)}
									>
										<Icon name="arrow-up" />
									</button>
								)}
								{process && (
									<button
										type="button"
										aria-label="Refit terminal"
										title="Refit & scroll to bottom"
										data-testid={`slot-refit-${slotIndex}`}
										onClick={() => requestRefit(process.id)}
									>
										<Icon name="download" />
									</button>
								)}
								{process && (
									<button
										type="button"
										aria-label="Restart shell"
										title="Restart"
										data-testid={`slot-restart-${slotIndex}`}
										onClick={() => requestSlotAction("restart", process)}
									>
										<Icon name="refresh" />
									</button>
								)}
								{process && (
									<button
										type="button"
										aria-label="Close shell"
										title="Close"
										data-testid={`slot-close-${slotIndex}`}
										onClick={() => requestSlotAction("close", process)}
									>
										<Icon name="close" />
									</button>
								)}
							</header>
							{termSession && (
								<TerminalPane
									session={termSession}
									visible={panelVisible}
									fitSignal={fitSignals[processId] ?? 0}
									fontSize={terminalFontSize}
									theme={terminalTheme}
									focused={
										process?.id === activeSession?.activeProcessSessionId
									}
									suppressAutoFocus={suppressAutoFocus}
									focusSignal={terminalFocusSignal}
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
										if (process && process.worktreeId === activeWorktree?.id)
											selectActiveProcess(process.id);
									}}
								/>
							)}
						</div>
					);
				})}
			</div>
			{pendingConfirm && (
				<ConfirmDialog
					key={`${pendingConfirm.kind}-${pendingConfirm.processId}`}
					open
					title={
						pendingConfirm.kind === "restart"
							? "Restart shell?"
							: "Close shell?"
					}
					body={
						pendingConfirm.kind === "restart" ? (
							<>
								This kills the running process in <b>{pendingConfirm.label}</b>{" "}
								and starts a fresh shell.
							</>
						) : (
							<>
								This kills the running process in <b>{pendingConfirm.label}</b>{" "}
								and removes the pane.
							</>
						)
					}
					confirmLabel={pendingConfirm.kind === "restart" ? "Restart" : "Close"}
					checkboxLabel={`Don't ask again for ${pendingConfirm.kind}`}
					onConfirm={(dontAskAgain) => {
						if (dontAskAgain) {
							void update(
								pendingConfirm.kind === "restart"
									? { terminalConfirm: { restart: false } }
									: { terminalConfirm: { close: false } },
							);
						}
						invokeSlotAction(pendingConfirm.kind, pendingConfirm.processId);
						setPendingConfirm(null);
					}}
					onCancel={() => setPendingConfirm(null)}
				/>
			)}
		</section>
	);
}
