// Shared rectangle text button used by both `ReviewChipBar` (collapsed) and
// `ReviewExpandedPortal` (expanded). Keeps the two review-header rows
// visually consistent — same shape, same padding, same icon+label rhythm.

import { Icon, type IconName } from "@/components/ui/icon";

type Props = {
	icon: IconName;
	/** Non-TUI fallback glyph override, forwarded to <Icon> — see its `fallback` prop. */
	iconFallback?: string;
	label: string;
	ariaLabel?: string;
	title?: string;
	onClick: () => void;
};

export function ReviewBarButton({
	icon,
	iconFallback,
	label,
	ariaLabel,
	title,
	onClick,
}: Props): React.ReactElement {
	return (
		<button
			type="button"
			className="shell-review-chipbar__open-btn"
			aria-label={ariaLabel ?? label}
			title={title ?? label}
			onClick={onClick}
		>
			<span aria-hidden="true">
				<Icon name={icon} fallback={iconFallback} />
			</span>
			<span>{label}</span>
		</button>
	);
}
