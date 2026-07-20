import { useEffect, useState } from "react";

/**
 * One-time first-capture notice (spec §7.4): shown once when the main
 * process fires `insights:notice` (electron/main/insights-ipc.ts), after
 * insights capture has actually started. "Manage in Settings" deep-links
 * into the Settings dialog (where the enable toggle + delete action live —
 * Task 13's InsightsSettingsControls) and both actions acknowledge the
 * notice so it never reappears (durable suppression via
 * usageTelemetry.insights.noticeShown).
 */
export function InsightsNotice({
	onOpenSettings,
}: {
	onOpenSettings: () => void;
}): React.ReactElement | null {
	const [show, setShow] = useState(false);

	// Optional chaining: some test harnesses stub a partial `window.ai14all`
	// (e.g. only `settings`), and this effect must not throw on mount there —
	// same defensive pattern as UsageStrip's `window.ai14all?.usage?.…`.
	useEffect(() => window.ai14all?.insights?.onNotice(() => setShow(true)), []);

	if (!show) return null;

	const ackAndClose = () => {
		void window.ai14all?.insights?.ackNotice();
		setShow(false);
	};

	return (
		<div role="status" className="insights-notice">
			<span>ai-14all now records local, content-free usage insights.</span>
			<button
				type="button"
				onClick={() => {
					onOpenSettings();
					ackAndClose();
				}}
			>
				Manage in Settings
			</button>
			<button type="button" onClick={ackAndClose}>
				Dismiss
			</button>
		</div>
	);
}
