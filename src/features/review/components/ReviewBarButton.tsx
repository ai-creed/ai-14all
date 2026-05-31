// Shared rectangle text button used by both `ReviewChipBar` (collapsed) and
// `ReviewExpandedPortal` (expanded). Keeps the two review-header rows
// visually consistent — same shape, same padding, same icon+label rhythm.

type Props = {
	icon: string;
	label: string;
	ariaLabel?: string;
	title?: string;
	onClick: () => void;
};

export function ReviewBarButton({
	icon,
	label,
	ariaLabel,
	title,
	onClick,
}: Props): React.ReactElement {
	return (
		<button
			type="button"
			className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border bg-muted/50 hover:bg-muted text-foreground"
			aria-label={ariaLabel ?? label}
			title={title ?? label}
			onClick={onClick}
		>
			<span aria-hidden="true">{icon}</span>
			<span>{label}</span>
		</button>
	);
}
