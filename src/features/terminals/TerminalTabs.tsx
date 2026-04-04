import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type {
	ProcessSession,
	ProcessStatus,
} from "../../../shared/models/process-session";
import type { CommandPreset } from "../../../shared/models/command-preset";

type ProcessTabView = Pick<
	ProcessSession,
	"id" | "label" | "status" | "pinned" | "attentionState"
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

const statusSuffix: Partial<Record<ProcessStatus, string>> = {
	exited: " (exited)",
	error: " (error)",
};

export function TerminalTabs({
	processes,
	activeProcessId,
	presets,
	onSelect,
	onAddAdHoc,
	onLaunchPreset,
	onOpenPresetManager,
	onClose,
}: Props) {
	return (
		<Tooltip.Provider delayDuration={150}>
			<Tabs.Root
				value={activeProcessId ?? undefined}
				onValueChange={onSelect}
				className="shell-panel shell-terminal-tabs"
			>
				<div className="shell-terminal-tabs__bar">
					<Tabs.List
						aria-label="Terminal sessions"
						className="shell-terminal-tabs__list"
					>
						{processes.map((process) => {
							const suffix = statusSuffix[process.status] ?? "";
							return (
								<div key={process.id} className="shell-terminal-tabs__item">
									<Tabs.Trigger
										value={process.id}
										className="shell-terminal-tab"
										data-status={process.status}
										data-attention={process.attentionState}
										data-pinned={String(process.pinned)}
										onClick={() => onSelect(process.id)}
									>
										{process.label}
										{suffix}
									</Tabs.Trigger>
									<Tooltip.Root>
										<Tooltip.Trigger asChild>
											<button
												type="button"
												className="shell-terminal-tab__close"
												aria-label={`Close ${process.label}`}
												onClick={() => onClose(process.id)}
											>
												×
											</button>
										</Tooltip.Trigger>
										<Tooltip.Portal>
											<Tooltip.Content className="shell-tooltip" sideOffset={8}>
												Close terminal
											</Tooltip.Content>
										</Tooltip.Portal>
									</Tooltip.Root>
								</div>
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
