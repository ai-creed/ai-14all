import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from "@/components/ui/tooltip";
import { AppDialog } from "../../../components/AppDialog";
import type {
	CommandPreset,
	PresetLaunchTarget,
} from "../../../../shared/models/command-preset";

type Props = {
	open: boolean;
	presets: CommandPreset[];
	onOpenChange: (open: boolean) => void;
	onSave: (preset: CommandPreset) => void;
	onDelete: (presetId: string) => void;
	onLaunch: (presetId: string) => void;
};

function launchLabel(target: PresetLaunchTarget): string {
	return target === "throwaway"
		? "Launch in throwaway shell"
		: "Launch in pinned terminal";
}

export function PresetManager({
	open,
	presets,
	onOpenChange,
	onSave,
	onDelete,
	onLaunch,
}: Props) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [label, setLabel] = useState("");
	const [command, setCommand] = useState("");
	const [target, setTarget] = useState<PresetLaunchTarget>("pinned");

	function handleEdit(preset: CommandPreset) {
		setEditingId(preset.id);
		setLabel(preset.label);
		setCommand(preset.command);
		setTarget(preset.target);
	}

	function handleSave() {
		if (!label.trim() || !command.trim()) return;
		onSave({
			id: editingId ?? crypto.randomUUID(),
			label: label.trim(),
			command: command.trim(),
			target,
		});
		setEditingId(null);
		setLabel("");
		setCommand("");
		setTarget("pinned");
	}

	return (
		<AppDialog open={open} onOpenChange={onOpenChange} size="wide">
			<AppDialog.Title>Command presets</AppDialog.Title>
			<AppDialog.Body>
				{presets.length > 0 && (
					<ul className="preset-list">
						{presets.map((preset) => (
							<li key={preset.id} className="preset-row">
								<div className="preset-row__text">
									<span className="preset-row__title">{preset.label}</span>
									<code className="preset-row__command">{preset.command}</code>
								</div>
								<div className="preset-row__actions">
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												className="preset-row__action"
												aria-label="Edit preset"
												data-testid={`preset-edit-${preset.id}`}
												onClick={() => handleEdit(preset)}
											>
												<Icon name="edit" />
											</button>
										</TooltipTrigger>
										<TooltipContent>Edit</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												className="preset-row__action"
												aria-label="Delete preset"
												data-testid={`preset-delete-${preset.id}`}
												onClick={() => onDelete(preset.id)}
											>
												<Icon name="trash" />
											</button>
										</TooltipTrigger>
										<TooltipContent>Delete</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												className="preset-row__action"
												aria-label={launchLabel(preset.target)}
												data-testid={`preset-launch-${preset.id}`}
												onClick={() => onLaunch(preset.id)}
											>
												<Icon name="play" />
											</button>
										</TooltipTrigger>
										<TooltipContent>
											{launchLabel(preset.target)}
										</TooltipContent>
									</Tooltip>
								</div>
							</li>
						))}
					</ul>
				)}

				<div className="preset-form">
					<div className="preset-form__field">
						<label htmlFor="preset-label">Preset label</label>
						<Input
							id="preset-label"
							type="text"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
						/>
					</div>
					<div className="preset-form__field">
						<label htmlFor="preset-command">Preset command</label>
						<Input
							id="preset-command"
							type="text"
							value={command}
							onChange={(e) => setCommand(e.target.value)}
						/>
					</div>
					<div className="preset-form__field">
						<span className="preset-form__label">Launch in</span>
						<div
							className="preset-target-toggle"
							role="group"
							aria-label="Launch target"
						>
							<button
								type="button"
								data-testid="preset-target-pinned"
								className="preset-target-toggle__option"
								aria-pressed={target === "pinned"}
								onClick={() => setTarget("pinned")}
							>
								Pinned
							</button>
							<button
								type="button"
								data-testid="preset-target-throwaway"
								className="preset-target-toggle__option"
								aria-pressed={target === "throwaway"}
								onClick={() => setTarget("throwaway")}
							>
								Throwaway
							</button>
						</div>
					</div>
					<div className="preset-form__actions">
						<Button
							type="button"
							variant="default"
							size="sm"
							onClick={handleSave}
						>
							Save preset
						</Button>
					</div>
				</div>
			</AppDialog.Body>
		</AppDialog>
	);
}
