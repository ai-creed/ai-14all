import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
	CaretDownIcon,
	GearIcon,
	PlusIcon,
	SquaresFourIcon,
} from "@phosphor-icons/react";
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
 * Terminal launch controls (add ad-hoc shell, layout dialog, preset menu)
 * rendered as chip-style buttons for the session chipbar's terminal group.
 * All shells are visible in the slot grid, so there is no per-shell tab strip.
 */
export function TerminalActions({
	presets,
	addDisabled,
	onAddAdHoc,
	onLaunchPreset,
	onOpenPresetManager,
	onOpenLayoutDialog,
}: Props) {
	return (
		<div className="shell-chip-bar__terminal-group">
			<button
				type="button"
				className="shell-chip-bar__action"
				data-testid="terminal-add-shell"
				aria-label="Add shell"
				disabled={addDisabled}
				onClick={onAddAdHoc}
			>
				<span className="shell-chip-bar__action-icon" aria-hidden="true">
					<PlusIcon size={14} weight="regular" />
				</span>
				Shell
			</button>
			<button
				type="button"
				className="shell-chip-bar__action"
				data-testid="terminal-layout-button"
				data-tour="layout"
				aria-label="Choose layout"
				title="Choose layout (⌘⇧L)"
				onClick={onOpenLayoutDialog}
			>
				<span className="shell-chip-bar__action-icon" aria-hidden="true">
					<SquaresFourIcon size={14} weight="regular" />
				</span>
				Layout
			</button>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild>
					<button type="button" className="shell-chip-bar__action">
						<span className="shell-chip-bar__action-icon" aria-hidden="true">
							<GearIcon size={14} weight="regular" />
						</span>
						Presets
						<CaretDownIcon size={12} weight="regular" aria-hidden="true" />
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
	);
}
