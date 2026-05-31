import { useState } from "react";
import {
	ArrowClockwiseIcon,
	ArrowLineDownIcon,
	ArrowUpIcon,
	PlusIcon,
	XIcon,
} from "@phosphor-icons/react";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import type { Worktree } from "../../../shared/models/worktree";
import type { WorkspaceAction } from "../../features/workspace/logic/workspace-state";
import type { WorkspaceState } from "../../../shared/models/workspace-state";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import type { ITheme } from "xterm";
import type { LayoutId } from "../../../shared/models/terminal-layout";
import { TERMINAL_LAYOUTS } from "../../features/terminals/logic/terminal-layouts";
import { TerminalPane } from "../../features/terminals/components/TerminalPane";
import { normalizeTerminalTitle } from "../normalize-terminal-title";

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
	findProcessByTerminalSessionId: (
		terminalSessionId: string,
	) => { process: ProcessSession; workspaceId: string } | null;
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
	} = props;

	// Per-process refit counters; bumping one tells that slot's pane to re-fit
	// and scroll to the bottom (manual recovery for vanished shell text).
	const [fitSignals, setFitSignals] = useState<Record<string, number>>({});
	const requestRefit = (processId: string) =>
		setFitSignals((prev) => ({
			...prev,
			[processId]: (prev[processId] ?? 0) + 1,
		}));

	if (!workspaceState.selectedWorktreeId) return null;

	const layout = TERMINAL_LAYOUTS[layoutId];
	const isMasterFamily =
		layout.distribution === "master" || layout.distribution === "double-master";
	// Shrink terminal text by 1px per two slots so denser layouts fit more rows:
	// 1–2 slots → 12, 3–4 → 11, 5–6 → 10.
	const terminalFontSize = 12 - Math.floor((layout.slotCount - 1) / 2);

	return (
		<section
			className="shell-panel shell-terminal-section"
			data-tour="terminal"
		>
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
								<button
									type="button"
									className="shell-terminal-slot__cta"
									data-testid={`slot-cta-${slotIndex}`}
									onClick={() => onStartShellInSlot(slotIndex)}
								>
									<PlusIcon size={14} weight="regular" aria-hidden="true" />
									start a shell
								</button>
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
										<ArrowUpIcon size={14} weight="regular" aria-hidden="true" />
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
										<ArrowLineDownIcon
											size={14}
											weight="regular"
											aria-hidden="true"
										/>
									</button>
								)}
								{process && (
									<button
										type="button"
										aria-label="Restart shell"
										title="Restart"
										data-testid={`slot-restart-${slotIndex}`}
										onClick={() => onRestartSlot(process.id)}
									>
										<ArrowClockwiseIcon
											size={14}
											weight="regular"
											aria-hidden="true"
										/>
									</button>
								)}
								{process && (
									<button
										type="button"
										aria-label="Close shell"
										title="Close"
										data-testid={`slot-close-${slotIndex}`}
										onClick={() => onCloseSlot(process.id)}
									>
										<XIcon size={14} weight="regular" aria-hidden="true" />
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
		</section>
	);
}
