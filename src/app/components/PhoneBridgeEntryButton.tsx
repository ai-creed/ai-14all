import React from "react";
import { useSettings } from "../hooks/use-settings";
import { isPhoneBridgeEnabled } from "../../../shared/models/persisted-settings";

/**
 * The sole user-facing phone-bridge entry point. Reads the feature flag from
 * settings and renders nothing when it is disabled, so a production build shows
 * no button (spec D4/D6).
 */
export function PhoneBridgeEntryButton(props: {
	onOpen: () => void;
}): React.ReactElement | null {
	const { settings } = useSettings();
	if (!isPhoneBridgeEnabled(settings)) return null;
	return (
		<button
			type="button"
			className="shell-chip-bar__action phone-bridge-entry-button"
			aria-label="Open Phone Bridge panel"
			onClick={props.onOpen}
		>
			Phone Bridge
		</button>
	);
}
