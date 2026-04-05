import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type {
	ProcessSession,
	ProcessStatus,
} from "../../../shared/models/process-session";
import type { CommandPreset } from "../../../shared/models/command-preset";

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

type Props = {
	processes: ProcessTabView[];
	activeProcessId: string | null;
	presets: CommandPreset[];
	onSelect: (processId: string) => void;
	onAddAdHoc: () => void;
	onLaunchPreset: (presetId: string) => void;
	onOpenPresetManager: () => void;
	onClose: (processId: string) => void;
	onStop: (processId: string) => void;
	onRestart: (processId: string) => void;
	onTogglePinned: (processId: string) => void;
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
	onSelect,
	onAddAdHoc,
	onLaunchPreset,
	onOpenPresetManager,
	onClose,
	onStop,
	onRestart,
	onTogglePinned,
}: Props) {
	return (
		<Tooltip.Provider delayDuration={150}>
			<Tabs.Root
				value={activeProcessId ?? undefined}
				onValueChange={onSelect}
				className="shell-terminal-tabs"
			>
				<div className="shell-terminal-tabs__bar">
					<Tabs.List
						aria-label="Terminal sessions"
						className="shell-terminal-tabs__list"
					>
						{processes.map((process) => {
							const suffix = formatStatusSuffix(
								process.status,
								process.exitCode,
							);
							return (
								<ContextMenu.Root key={process.id}>
									<ContextMenu.Trigger className="shell-terminal-tabs__item">
										<Tabs.Trigger
											value={process.id}
											className="shell-terminal-tab"
											data-status={process.status}
											data-attention={process.attentionState}
											data-pinned={String(process.pinned)}
											{...(process.lastActivityAt != null
												? { "data-last-activity": String(process.lastActivityAt) }
												: {})}
										>
											{process.label}
											{suffix}
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

					<button
						type="button"
						className="shell-button"
						onClick={onAddAdHoc}
						aria-label="+ Shell"
					>
						+ Shell
					</button>

					{presets.length > 0 && (
						<DropdownMenu.Root>
							<DropdownMenu.Trigger asChild>
								<button type="button" className="shell-button">
									Launch preset
								</button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content className="shell-toolbar-menu">
									{presets.map((preset) => (
										<DropdownMenu.Item
											key={preset.id}
											className="shell-toolbar-menu__item"
											onSelect={() => onLaunchPreset(preset.id)}
										>
											{preset.label}
										</DropdownMenu.Item>
									))}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					)}

					<button
						type="button"
						className="shell-button"
						onClick={onOpenPresetManager}
					>
						Manage presets
					</button>
				</div>
			</Tabs.Root>
		</Tooltip.Provider>
	);
}
