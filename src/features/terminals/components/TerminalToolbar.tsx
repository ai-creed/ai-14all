import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { CommandPreset } from "../../../../shared/models/command-preset";

type Props = {
	presets: CommandPreset[];
	/** True when 6 shells are running — the add control is disabled. */
	addDisabled: boolean;
	onAddAdHoc: () => void;
	onLaunchPreset: (presetId: string) => void;
	onOpenPresetManager: () => void;
	onOpenLayoutDialog: () => void;
};

/**
 * Terminal toolbar: launch controls (add ad-hoc shell, preset menu, preset
 * manager) and the layout-dialog button. All shells are visible in the slot
 * grid, so there is no per-shell tab strip.
 */
export function TerminalToolbar({
	presets,
	addDisabled,
	onAddAdHoc,
	onLaunchPreset,
	onOpenPresetManager,
	onOpenLayoutDialog,
}: Props) {
	return (
		<div className="shell-terminal-tabs">
			<div className="shell-terminal-tabs__bar">
				<div className="shell-terminal-tabs__utilities">
					<button
						type="button"
						className="shell-button shell-button--icon shell-button--compact shell-button--round"
						data-testid="terminal-add-shell"
						aria-label="Add shell"
						disabled={addDisabled}
						onClick={onAddAdHoc}
					>
						+
					</button>
					<button
						type="button"
						className="shell-button shell-button--icon shell-button--compact shell-button--round"
						data-testid="terminal-layout-button"
						aria-label="Choose layout"
						title="Choose layout (⌘⇧L)"
						onClick={onOpenLayoutDialog}
					>
						▦
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
		</div>
	);
}
