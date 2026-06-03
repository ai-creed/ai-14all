import { useState } from "react";
import { Input } from "@/components/ui/input";
import { AppDialog } from "../../../components/AppDialog";
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
					<ul style={{ listStyle: "none", padding: 0 }}>
						{presets.map((preset) => (
							<li
								key={preset.id}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "var(--space-2)",
									marginBottom: "var(--space-2)",
								}}
							>
								<span style={{ flex: 1 }}>
									{preset.label} — <code>{preset.command}</code>
								</span>
								<button
									type="button"
									className="shell-button shell-button--compact"
									onClick={() => handleEdit(preset)}
								>
									Edit
								</button>
								<button
									type="button"
									className="shell-button shell-button--compact"
									onClick={() => onDelete(preset.id)}
								>
									Delete
								</button>
								<button
									type="button"
									className="shell-button shell-button--compact"
									onClick={() => onLaunch(preset.id)}
								>
									Launch
								</button>
							</li>
						))}
					</ul>
				)}

				<div style={{ marginTop: "var(--space-4)" }}>
					<div style={{ marginBottom: "var(--space-2)" }}>
						<label htmlFor="preset-label">Preset label</label>
						<Input
							id="preset-label"
							type="text"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
						/>
					</div>
					<div style={{ marginBottom: "var(--space-2)" }}>
						<label htmlFor="preset-command">Preset command</label>
						<Input
							id="preset-command"
							type="text"
							value={command}
							onChange={(e) => setCommand(e.target.value)}
						/>
					</div>
					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							gap: "var(--space-2)",
							marginTop: "var(--space-3)",
						}}
					>
						<button
							type="button"
							className="shell-button shell-button--compact shell-button--primary"
							onClick={handleSave}
						>
							Save preset
						</button>
					</div>
				</div>
			</AppDialog.Body>
		</AppDialog>
	);
}
