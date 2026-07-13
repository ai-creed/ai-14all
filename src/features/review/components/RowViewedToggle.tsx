type Props = { reviewed: boolean; onToggle: () => void };

/**
 * GitHub-style inline "Viewed" toggle rendered on the currently-open file's row
 * in the Changes/Commits lists. Sibling to the file-select control (never nested
 * inside it), and the visible counterpart to the ⌘⇧V / Ctrl+Shift+V shortcut.
 */
export function RowViewedToggle({
	reviewed,
	onToggle,
}: Props): React.ReactElement {
	return (
		<button
			type="button"
			className="shell-review-row-viewed"
			data-testid="mark-viewed-toggle"
			data-reviewed={reviewed}
			aria-pressed={reviewed}
			onClick={(e) => {
				// The row's context-menu trigger wraps this control; stop the click
				// from also reaching the file-select button beside it.
				e.stopPropagation();
				onToggle();
			}}
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
