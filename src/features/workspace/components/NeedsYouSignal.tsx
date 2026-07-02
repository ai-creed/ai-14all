import { Icon } from "@/components/ui/icon";
import { needsYouLabel } from "../logic/attention-signal";
import type { SidebarAttentionTier } from "../logic/sidebar-shell-summary";

/**
 * Non-color attention signal for a sidebar row. For `actionRequired` it renders
 * a distinct Nerd Font glyph + the "needs you" text with an `aria-label`, so the
 * state is legible without relying on hue or motion (colorblind + screen-reader
 * safe). Renders nothing for every other tier.
 */
export function NeedsYouSignal({ tier }: { tier: SidebarAttentionTier }) {
	const label = needsYouLabel(tier);
	if (!label) return null;
	return (
		<span
			className="shell-sidebar__needs-you"
			data-testid="row-needs-you"
			aria-label="Needs your attention"
		>
			<Icon name="info" />
			{label}
		</span>
	);
}
