import { useState } from "react";
import { AppDialog } from "../../../components/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommandPreset } from "../../../../shared/models/command-preset";

type Props = {
	open: boolean;
	presets: CommandPreset[];
	onOpenChange: (open: boolean) => void;
	onSave: (preset: CommandPreset) => void;
	onDelete: (presetId: string) => void;
	onLaunch: (presetId: string) => void;
};

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

	function handleEdit(preset: CommandPreset) {
		setEditingId(preset.id);
		setLabel(preset.label);
		setCommand(preset.command);
	}

	function handleSave() {
		if (!label.trim() || !command.trim()) return;
		onSave({
			id: editingId ?? crypto.randomUUID(),
			label: label.trim(),
			command: command.trim(),
		});
		setEditingId(null);
		setLabel("");
		setCommand("");
	}

	return (
		<AppDialog open={open} onOpenChange={onOpenChange} size="wide">
			<AppDialog.Title>Command presets</AppDialog.Title>
			<AppDialog.Body>
				{presets.length > 0 && (
					<ul className="list-none p-0">
						{presets.map((preset) => (
							<li
								key={preset.id}
								className="flex items-center gap-2 mb-2"
							>
								<span className="flex-1">
									{preset.label} — <code>{preset.command}</code>
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => handleEdit(preset)}
								>
									Edit
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => onDelete(preset.id)}
								>
									Delete
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => onLaunch(preset.id)}
								>
									Launch
								</Button>
							</li>
						))}
					</ul>
				)}

				<div className="mt-4">
					<div className="space-y-2 mb-2">
						<Label htmlFor="preset-label">Preset label</Label>
						<Input
							id="preset-label"
							type="text"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
						/>
					</div>
					<div className="space-y-2 mb-2">
						<Label htmlFor="preset-command">Preset command</Label>
						<Input
							id="preset-command"
							type="text"
							value={command}
							onChange={(e) => setCommand(e.target.value)}
						/>
					</div>
					<div className="flex justify-end gap-2 mt-3">
						<Button
							type="button"
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
