import type { SidebarAttentionTier } from "./sidebar-shell-summary";

/** Visible, color-independent label for the must-not-miss attention state. */
export const NEEDS_YOU_LABEL = "needs you";

/**
 * The non-color signal for `actionRequired` rows. Returns the label to render
 * (as a distinct shape + text, reinforced by — never dependent on — color and
 * motion) or null when no explicit label is needed.
 */
export function needsYouLabel(tier: SidebarAttentionTier): string | null {
	return tier === "actionRequired" ? NEEDS_YOU_LABEL : null;
}
