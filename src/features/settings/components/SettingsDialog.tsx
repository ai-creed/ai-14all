import * as Dialog from "@radix-ui/react-dialog";
import type React from "react";
import { useSettings } from "../../../app/hooks/use-settings";
import type {
	AgentResumeMode,
	RestoreDepth,
	ThemeMode,
} from "../../../../shared/models/persisted-settings";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "System" },
	{ value: "warm", label: "Warm" },
	{ value: "tui", label: "TUI" },
];

const RESTORE_PREFERENCE_OPTIONS = [
	{ value: "prompt", label: "ask every time" },
	{ value: "alwaysRestore", label: "always restore" },
	{ value: "alwaysStartClean", label: "always start clean" },
] as const;

const RESTORE_DEPTH_OPTIONS: { value: RestoreDepth; label: string }[] = [
	{ value: "stateEagerTerminalsLazy", label: "all workspaces" },
	{ value: "activeOnly", label: "active workspace only" },
];

const AGENT_RESUME_OPTIONS: { value: AgentResumeMode; label: string }[] = [
	{ value: "auto", label: "auto" },
	{ value: "manual", label: "manual" },
	{ value: "off", label: "off" },
];

const CHIP_RANGE_OPTIONS: { value: "week" | "month"; label: string }[] = [
	{ value: "week", label: "week" },
	{ value: "month", label: "month" },
];

/**
 * Settings dialog: Appearance / Startup / Agents / Usage groups, each backed
 * by `useSettings().update()` (write-through to the persisted settings file —
 * see Task 4's SettingsProvider). Modeled on PluginsPanelDialog's raw
 * `@radix-ui/react-dialog` idiom (not the shadcn `src/components/ui/dialog`
 * wrapper) so the TUI trait set (square corners, solid separators, flat
 * surfaces, no drop shadows) is applied directly via `settings-dialog__*`
 * classes rather than inherited shadcn defaults.
 */
export function SettingsDialog({
	open,
	onOpenChange,
}: Props): React.ReactElement {
	const { settings, update } = useSettings();

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="settings-dialog__overlay" />
				<Dialog.Content
					className="settings-dialog"
					data-testid="settings-dialog"
				>
					<Dialog.Title className="settings-dialog__title">
						Settings
					</Dialog.Title>

					<section className="settings-dialog__section">
						<h3 className="settings-dialog__section-title">Appearance</h3>
						<div className="settings-dialog__row">
							<label htmlFor="settings-theme">Theme</label>
							<select
								id="settings-theme"
								value={settings.theme}
								onChange={(e) =>
									void update({ theme: e.target.value as ThemeMode })
								}
							>
								{THEME_OPTIONS.map((t) => (
									<option key={t.value} value={t.value}>
										{t.label}
									</option>
								))}
							</select>
						</div>
						<div className="settings-dialog__row">
							<label htmlFor="settings-font">Terminal font size</label>
							<input
								id="settings-font"
								type="number"
								min={10}
								max={20}
								value={settings.terminalFontSize}
								onChange={(e) =>
									void update({
										terminalFontSize: Number.parseInt(e.target.value, 10),
									})
								}
							/>
						</div>
					</section>

					<section className="settings-dialog__section">
						<h3 className="settings-dialog__section-title">Startup</h3>
						<div className="settings-dialog__row">
							<label htmlFor="settings-restore-pref">Restore on launch</label>
							<select
								id="settings-restore-pref"
								value={settings.restorePreference}
								onChange={(e) =>
									void update({
										restorePreference: e.target
											.value as (typeof RESTORE_PREFERENCE_OPTIONS)[number]["value"],
									})
								}
							>
								{RESTORE_PREFERENCE_OPTIONS.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
							</select>
						</div>
						<div className="settings-dialog__row">
							<label htmlFor="settings-restore-depth">Restore depth</label>
							<select
								id="settings-restore-depth"
								value={settings.restoreDepth}
								onChange={(e) =>
									void update({
										restoreDepth: e.target.value as RestoreDepth,
									})
								}
							>
								{RESTORE_DEPTH_OPTIONS.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
							</select>
						</div>
					</section>

					<section className="settings-dialog__section">
						<h3 className="settings-dialog__section-title">Agents</h3>
						<div className="settings-dialog__row">
							<label htmlFor="settings-agent-resume">Conversation resume</label>
							<select
								id="settings-agent-resume"
								value={settings.agentResume}
								onChange={(e) =>
									void update({
										agentResume: e.target.value as AgentResumeMode,
									})
								}
							>
								{AGENT_RESUME_OPTIONS.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
							</select>
						</div>
					</section>

					<section className="settings-dialog__section">
						<h3 className="settings-dialog__section-title">Usage</h3>
						<div className="settings-dialog__row">
							<label className="settings-dialog__checkbox-label">
								<input
									type="checkbox"
									checked={settings.usageTelemetry.enabled}
									onChange={(e) =>
										void update({
											usageTelemetry: {
												...settings.usageTelemetry,
												enabled: e.target.checked,
											},
										})
									}
								/>
								usage telemetry
							</label>
						</div>
						<div className="settings-dialog__row">
							<label className="settings-dialog__checkbox-label">
								<input
									type="checkbox"
									checked={settings.usageTelemetry.includeUntracked}
									onChange={(e) =>
										void update({
											usageTelemetry: {
												...settings.usageTelemetry,
												includeUntracked: e.target.checked,
											},
										})
									}
								/>
								include untracked
							</label>
						</div>
						<div className="settings-dialog__row">
							<label htmlFor="settings-chip-range">Chip range</label>
							<select
								id="settings-chip-range"
								value={settings.usageTelemetry.chipRange}
								onChange={(e) =>
									void update({
										usageTelemetry: {
											...settings.usageTelemetry,
											chipRange: e.target.value as "week" | "month",
										},
									})
								}
							>
								{CHIP_RANGE_OPTIONS.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
							</select>
						</div>
					</section>

					<Dialog.Close asChild>
						<button type="button" className="settings-dialog__close">
							Close
						</button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
