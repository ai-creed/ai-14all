import React from "react";
import { useSettings } from "../hooks/use-settings";
import { isPhoneBridgeEnabled } from "../../../shared/models/persisted-settings";
import { PhoneBridgeDialog } from "../../components/settings/PhoneBridgeDialog";

/**
 * Renders the phone-bridge dialog only when the feature flag is enabled
 * (spec D4). App owns the open/close state and passes it through; when the flag
 * is off the dialog is never mounted, so it cannot surface.
 */
export function PhoneBridgeDialogGate(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): React.ReactElement | null {
	const { settings } = useSettings();
	if (!isPhoneBridgeEnabled(settings)) return null;
	return (
		<PhoneBridgeDialog open={props.open} onOpenChange={props.onOpenChange} />
	);
}
