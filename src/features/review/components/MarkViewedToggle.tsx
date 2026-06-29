type Props = { reviewed: boolean; onToggle: () => void };

/**
 * GitHub-style "Viewed" toggle for the current review file. A visible,
 * discoverable counterpart to the keyboard-only ⌘⇧V / Ctrl+Shift+V shortcut.
 */
export function MarkViewedToggle({
	reviewed,
	onToggle,
}: Props): React.ReactElement {
	return (
		<button
			type="button"
			className="shell-review-mark-viewed"
			data-testid="mark-viewed-toggle"
			data-reviewed={reviewed}
			aria-pressed={reviewed}
			onClick={onToggle}
		>
			<span
				aria-hidden="true"
				style={{
					color: reviewed ? "var(--success)" : "var(--muted-foreground)",
				}}
			>
				{reviewed ? "✓" : "○"}
			</span>
			{reviewed ? "Viewed" : "Mark viewed"}
		</button>
	);
}
