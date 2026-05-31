import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
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
		<div className="flex items-center gap-1">
			<Button
				variant="ghost"
				size="sm"
				className="h-7 text-xs gap-1"
				data-testid="terminal-add-shell"
				aria-label="Add shell"
				disabled={addDisabled}
				onClick={onAddAdHoc}
			>
				<span aria-hidden="true">＋</span>
				Shell
			</Button>
			<Button
				variant="ghost"
				size="sm"
				className="h-7 text-xs gap-1"
				data-testid="terminal-layout-button"
				aria-label="Choose layout"
				title="Choose layout (⌘⇧L)"
				onClick={onOpenLayoutDialog}
			>
				<span aria-hidden="true">▦</span>
				Layout
			</Button>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
						<span aria-hidden="true">⚙</span>
						Presets
						<span aria-hidden="true">▾</span>
					</Button>
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
