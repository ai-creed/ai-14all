import { AppDialog } from "./AppDialog";
import type { ThemeMode } from "../lib/use-theme";

type Props = {
	open: boolean;
	onClose: () => void;
	currentTheme: ThemeMode;
	onChangeTheme: (theme: ThemeMode) => void;
	onResetOnboarding: () => void;
};

const THEMES: { value: ThemeMode; label: string; hint: string }[] = [
	{ value: "system", label: "System", hint: "Follow your OS" },
	{ value: "light", label: "Light", hint: "" },
	{ value: "dark", label: "Dark", hint: "" },
	{ value: "warm", label: "Warm", hint: "Espresso/umber palette" },
];

/**
 * Lightweight preferences modal. Today: theme switch + onboarding reset
 * (welcome hint + guided tour). The agent CLI override lives inside the
 * AgentInstallModal; per-provider budget settings live inside the UsagePopover.
 * We intentionally don't duplicate those settings here — this dialog is the
 * home for app-wide preferences that have no other home.
 */
export function PreferencesDialog({
	open,
	onClose,
	currentTheme,
	onChangeTheme,
	onResetOnboarding,
}: Props) {
	return (
		<AppDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<AppDialog.Title>Preferences</AppDialog.Title>
			<AppDialog.Body>
				<section className="shell-prefs__section">
					<div className="shell-prefs__section-title">Theme</div>
					<div className="shell-prefs__theme-options">
						{THEMES.map((t) => (
							<label key={t.value} className="shell-prefs__theme-option">
								<input
									type="radio"
									name="theme"
									value={t.value}
									checked={currentTheme === t.value}
									onChange={() => onChangeTheme(t.value)}
								/>
								<span className="shell-prefs__theme-label">
									<strong>{t.label}</strong>
									{t.hint && (
										<span className="shell-prefs__theme-hint"> · {t.hint}</span>
									)}
								</span>
							</label>
						))}
					</div>
				</section>

				<section className="shell-prefs__section">
					<div className="shell-prefs__section-title">Onboarding</div>
					<p className="shell-prefs__section-body">
						Reset the welcome hint and guided tour so they show again on
						the next session. Useful for re-running the tour or showing a
						new teammate around.
					</p>
					<button
						type="button"
						className="shell-button shell-button--compact"
						onClick={onResetOnboarding}
					>
						Reset welcome &amp; tour
					</button>
				</section>
			</AppDialog.Body>
			<AppDialog.Footer>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--primary"
					onClick={onClose}
				>
					Close
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
