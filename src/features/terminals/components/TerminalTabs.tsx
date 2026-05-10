import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type {
	ProcessSession,
	ProcessStatus,
} from "../../../../shared/models/process-session";
import type { CommandPreset } from "../../../../shared/models/command-preset";

type ProcessTabView = Pick<
	ProcessSession,
	| "id"
	| "label"
	| "status"
	| "pinned"
	| "attentionState"
	| "exitCode"
	| "lastActivityAt"
>;

type SplitSlot = "left" | "right";

type Props = {
	processes: ProcessTabView[];
	activeProcessId: string | null;
	presets: CommandPreset[];
	layoutMode: "single" | "split";
	splitLeftProcessId: string | null;
	splitRightProcessId: string | null;
	onSelect: (processId: string) => void;
	onAddAdHoc: () => void;
	onLaunchPreset: (presetId: string) => void;
	onOpenPresetManager: () => void;
	onClose: (processId: string) => void;
	onStop: (processId: string) => void;
	onRestart: (processId: string) => void;
	onTogglePinned: (processId: string) => void;
	onToggleSplitMode: () => void;
	onShowInSplit: (processId: string, slot: SplitSlot) => void;
	onRemoveFromSplit: (processId: string) => void;
};

function formatStatusSuffix(
	status: ProcessStatus,
	exitCode: number | null,
): string {
	if (status === "exited") {
		return exitCode ? ` (exited: ${exitCode})` : " (exited)";
	}
	if (status === "error") {
		return exitCode != null ? ` (error: ${exitCode})` : " (error)";
	}
	return "";
}

export function TerminalTabs({
	processes,
	activeProcessId,
	presets,
	layoutMode,
	splitLeftProcessId,
	splitRightProcessId,
	onSelect,
	onAddAdHoc,
	onLaunchPreset,
	onOpenPresetManager,
	onClose,
	onStop,
	onRestart,
	onTogglePinned,
	onToggleSplitMode,
	onShowInSplit,
	onRemoveFromSplit,
}: Props) {
	return (
		<Tooltip.Provider delayDuration={150}>
			<Tabs.Root
				value={activeProcessId ?? undefined}
				className="shell-terminal-tabs"
			>
				<div className="shell-terminal-tabs__bar">
					<div className="shell-terminal-tabs__scroller">
						<Tabs.List
							aria-label="Terminal sessions"
							className="shell-terminal-tabs__list shell-terminal-tabs__segments"
						>
							{processes.map((process) => {
								const suffix = formatStatusSuffix(
									process.status,
									process.exitCode,
								);
								return (
									<ContextMenu.Root key={process.id}>
										<ContextMenu.Trigger
											className="shell-terminal-tabs__item"
											onMouseDown={(e) => {
												// Left-click only: prevent the browser from moving
												// keyboard focus to the tab button. This keeps
												// focus in the terminal so typing works immediately.
												if (e.button === 0) e.preventDefault();
											}}
											onClick={(e) => {
												// Fire onSelect for every left-click, including
												// re-clicks of the already-active tab (Radix
												// onValueChange skips those since value doesn't change).
												if (e.button === 0) onSelect(process.id);
											}}
										>
											<Tabs.Trigger
												value={process.id}
												className="shell-terminal-tab"
												data-status={process.status}
												data-attention={process.attentionState}
												data-pinned={String(process.pinned)}
												data-split-slot={
													splitLeftProcessId === process.id
														? "left"
														: splitRightProcessId === process.id
															? "right"
															: "none"
												}
												{...(process.lastActivityAt != null
													? {
															"data-last-activity": String(
																process.lastActivityAt,
															),
														}
													: {})}
											>
												<span className="shell-terminal-tab__label">
													{process.label}
													{suffix}
												</span>
											</Tabs.Trigger>
										</ContextMenu.Trigger>
										<ContextMenu.Portal>
											<ContextMenu.Content className="shell-toolbar-menu">
												<ContextMenu.Item
													className="shell-toolbar-menu__item"
													onSelect={() => onStop(process.id)}
												>
													Stop
												</ContextMenu.Item>
												<ContextMenu.Item
													className="shell-toolbar-menu__item"
													onSelect={() => onRestart(process.id)}
												>
													Restart
												</ContextMenu.Item>
												<ContextMenu.Item
													className="shell-toolbar-menu__item"
													onSelect={() => onTogglePinned(process.id)}
												>
													{process.pinned ? "Unpin" : "Pin"}
												</ContextMenu.Item>
												<ContextMenu.Item
													className="shell-toolbar-menu__item"
													onSelect={() => onShowInSplit(process.id, "left")}
												>
													Show in split left
												</ContextMenu.Item>
												<ContextMenu.Item
													className="shell-toolbar-menu__item"
													onSelect={() => onShowInSplit(process.id, "right")}
												>
													Show in split right
												</ContextMenu.Item>
												{(splitLeftProcessId === process.id ||
													splitRightProcessId === process.id) && (
													<ContextMenu.Item
														className="shell-toolbar-menu__item"
														onSelect={() => onRemoveFromSplit(process.id)}
													>
														Remove from split
													</ContextMenu.Item>
												)}
												<ContextMenu.Separator className="shell-toolbar-menu__separator" />
												<ContextMenu.Item
													className="shell-toolbar-menu__item shell-toolbar-menu__item--danger"
													onSelect={() => onClose(process.id)}
												>
													Close
												</ContextMenu.Item>
											</ContextMenu.Content>
										</ContextMenu.Portal>
									</ContextMenu.Root>
								);
							})}
						</Tabs.List>
					</div>

					<div className="shell-terminal-tabs__utilities">
						<button
							type="button"
							className="shell-button shell-button--icon shell-button--compact shell-button--round"
							onClick={onAddAdHoc}
							aria-label="Add shell"
						>
							+
						</button>
						<button
							type="button"
							className="shell-button shell-button--icon shell-button--compact shell-button--round shell-terminal-tabs__split-toggle"
							aria-pressed={layoutMode === "split"}
							data-active={layoutMode === "split" ? "true" : "false"}
							aria-label={
								layoutMode === "split"
									? "Disable split shells"
									: "Enable split shells"
							}
							onClick={onToggleSplitMode}
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 16 16"
								className="shell-terminal-tabs__split-toggle-icon"
							>
								<rect x="2" y="3" width="5" height="10" rx="1.5" />
								<rect x="9" y="3" width="5" height="10" rx="1.5" />
							</svg>
						</button>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger asChild>
								<button
									type="button"
									className="shell-button shell-button--compact"
								>
									Presets
								</button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content className="shell-toolbar-menu">
									{presets.length === 0 ? (
										<DropdownMenu.Item
											disabled
											className="shell-toolbar-menu__item shell-toolbar-menu__item--disabled"
										>
											No presets yet
										</DropdownMenu.Item>
									) : (
										presets.map((preset) => (
											<DropdownMenu.Item
												key={preset.id}
												className="shell-toolbar-menu__item"
												onSelect={() => onLaunchPreset(preset.id)}
											>
												{preset.label}
											</DropdownMenu.Item>
										))
									)}
									<DropdownMenu.Separator className="shell-toolbar-menu__separator" />
									<DropdownMenu.Item
										className="shell-toolbar-menu__item"
										onSelect={onOpenPresetManager}
									>
										Manage presets
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					</div>
				</div>
			</Tabs.Root>
		</Tooltip.Provider>
	);
}
