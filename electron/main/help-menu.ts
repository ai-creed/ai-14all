// Type-only electron import → this module has no runtime electron dependency,
// so the submenu construction is unit-testable outside an Electron process.
import type { MenuItemConstructorOptions } from "electron";

export const HELP_SHOW_TOUR_CHANNEL = "help/showWelcomeTour";
export const HELP_RESET_ONBOARDING_CHANNEL = "help/resetOnboardingHints";

/** The Help submenu, with onboarding replay/reset wired to `send`. */
export function buildHelpSubmenu(
	send: (channel: string) => void,
): MenuItemConstructorOptions {
	return {
		label: "Help",
		submenu: [
			{
				id: "help-show-welcome-tour",
				label: "Show Welcome Tour",
				click: () => send(HELP_SHOW_TOUR_CHANNEL),
			},
			{
				id: "help-reset-onboarding",
				label: "Reset Onboarding Hints",
				click: () => send(HELP_RESET_ONBOARDING_CHANNEL),
			},
		],
	};
}
