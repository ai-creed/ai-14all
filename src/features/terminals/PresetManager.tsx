import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type { CommandPreset } from "../../../shared/models/command-preset";

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
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-preset-overlay" />
				<Dialog.Content className="shell-preset-dialog">
					<Dialog.Title>Command presets</Dialog.Title>

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
									<button type="button" onClick={() => handleEdit(preset)}>
										Edit
									</button>
									<button type="button" onClick={() => onDelete(preset.id)}>
										Delete
									</button>
									<button type="button" onClick={() => onLaunch(preset.id)}>
										Launch
									</button>
								</li>
							))}
						</ul>
					)}

					<div style={{ marginTop: "var(--space-4)" }}>
						<div style={{ marginBottom: "var(--space-2)" }}>
							<label htmlFor="preset-label">Preset label</label>
							<input
								id="preset-label"
								type="text"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								className="shell-note-input"
							/>
						</div>
						<div style={{ marginBottom: "var(--space-2)" }}>
							<label htmlFor="preset-command">Preset command</label>
							<input
								id="preset-command"
								type="text"
								value={command}
								onChange={(e) => setCommand(e.target.value)}
								className="shell-note-input"
							/>
						</div>
						<button type="button" className="shell-button" onClick={handleSave}>
							Save preset
						</button>
					</div>

					<Dialog.Close asChild>
						<button
							type="button"
							className="shell-button"
							style={{ marginTop: "var(--space-4)" }}
							aria-label="Close dialog"
						>
							Close
						</button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
