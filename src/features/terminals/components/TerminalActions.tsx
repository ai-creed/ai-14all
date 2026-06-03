import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CommandPreset } from "../../../../shared/models/command-preset";
import {
	type Platform,
	shortcutHint,
	detectPlatform,
} from "../../../app/shortcut-registry";

type Props = {
	presets: CommandPreset[];
	/** True when 6 shells are running — the add control is disabled. */
	addDisabled: boolean;
	onAddAdHoc: () => void;
	onLaunchPreset: (presetId: string) => void;
	onOpenPresetManager: () => void;
	onOpenLayoutDialog: () => void;
	/** Defaults to the detected platform; injected in tests. */
	platform?: Platform;
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
	platform = detectPlatform(),
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
					＋
				</span>
				Shell
			</button>
			<button
				type="button"
				className="shell-chip-bar__action"
				data-testid="terminal-layout-button"
				aria-label="Choose layout"
				title={`Choose layout (${shortcutHint("⌘⇧L", "Ctrl+Shift+L", platform)})`}
				onClick={onOpenLayoutDialog}
			>
				<span className="shell-chip-bar__action-icon" aria-hidden="true">
					▦
				</span>
				Layout
			</button>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button type="button" className="shell-chip-bar__action">
						<span className="shell-chip-bar__action-icon" aria-hidden="true">
							⚙
						</span>
						Presets
						<span aria-hidden="true">▾</span>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					{presets.length === 0 ? (
						<DropdownMenuItem disabled>No presets yet</DropdownMenuItem>
					) : (
						presets.map((preset) => (
							<DropdownMenuItem
								key={preset.id}
								onSelect={() => onLaunchPreset(preset.id)}
							>
								{preset.label}
							</DropdownMenuItem>
						))
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={onOpenPresetManager}>
						Manage presets
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
