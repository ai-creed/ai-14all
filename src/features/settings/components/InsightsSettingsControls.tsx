import type React from "react";
import { useSettings } from "../../../app/hooks/use-settings.js";

/**
 * Insights sub-controls for the Settings dialog's Usage section (Task 13):
 * an enable toggle and a delete-all action for the local, content-free
 * usage insights capture (Task 12).
 */
export function InsightsSettingsControls(): React.ReactElement {
	const { settings, update } = useSettings();
	const t = settings.usageTelemetry;

	return (
		<>
			<div className="settings-dialog__row">
				<label className="settings-dialog__checkbox-label">
					<input
						type="checkbox"
						aria-label="usage insights"
						checked={t.insights.enabled}
						onChange={(e) => {
							// Persist the sub-preference only; the MAIN process derives
							// effective consent and starts/stops the host on
							// settings:write (applyInsightsConsent, Task 12). Spreading
							// the full nested objects matches the dialog's existing
							// usageTelemetry handlers.
							void update({
								usageTelemetry: {
									...t,
									insights: { ...t.insights, enabled: e.target.checked },
								},
							});
						}}
					/>
					usage insights (local, content-free)
				</label>
			</div>
			<div className="settings-dialog__row">
				<button
					type="button"
					className="settings-dialog__danger"
					onClick={() => void window.ai14all.insights.deleteAll()}
				>
					Delete insights data
				</button>
			</div>
		</>
	);
}
