import { useEffect, useState } from "react";
import { HandWavingIcon, XIcon } from "@phosphor-icons/react";

type Props = {
	/** True when the user has at least one active session — gates first display. */
	hasActiveSession: boolean;
	/** True when the user has already dismissed this hint (from onboarding state). */
	dismissed: boolean;
	/** Called when the user clicks the × — caller marks the onboarding step. */
	onDismiss: () => void;
};

/**
 * One-time hint banner shown the first time a user has an active session.
 * Suggests typing their agent CLI in the terminal and points to the chipbar
 * help menu. Persistence lives in the onboarding state machine (parent owns
 * the `dismissed` flag) so the Preferences dialog can reset it centrally.
 *
 * Adds a soft pulse animation after ~1s to draw the eye, since first-time
 * users often miss persistent banners.
 */
export function FirstRunHint({
	hasActiveSession,
	dismissed,
	onDismiss,
}: Props) {
	const [pulsing, setPulsing] = useState(false);

	useEffect(() => {
		if (dismissed || !hasActiveSession) return;
		const t = setTimeout(() => setPulsing(true), 800);
		return () => clearTimeout(t);
	}, [dismissed, hasActiveSession]);

	if (dismissed || !hasActiveSession) return null;

	return (
		<div
			className={`shell-first-run-hint${pulsing ? " shell-first-run-hint--pulse" : ""}`}
			role="note"
			aria-label="Welcome hint"
		>
			<span className="shell-first-run-hint__icon" aria-hidden="true">
				<HandWavingIcon size={20} weight="regular" />
			</span>
			<div className="shell-first-run-hint__body">
				<strong>Welcome to ai-14all.</strong> Start working by typing your
				agent CLI in the terminal — try <code>claude</code> or{" "}
				<code>codex</code>. Tap the <strong>?</strong> in the top bar for
				keyboard shortcuts and concept docs.
			</div>
			<button
				type="button"
				className="shell-first-run-hint__dismiss"
				aria-label="Dismiss welcome hint"
				onClick={onDismiss}
			>
				<XIcon size={14} weight="regular" aria-hidden="true" />
			</button>
		</div>
	);
}
