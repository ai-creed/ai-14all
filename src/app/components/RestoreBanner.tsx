type Props = {
	message: string | null;
	onDismiss: () => void;
};

/**
 * Status banner shown at the top of the shell when a workspace restore
 * surfaced a recoverable warning. Renders nothing when `message` is null.
 */
export function RestoreBanner(props: Props): React.ReactElement | null {
	const { message, onDismiss } = props;
	if (!message) return null;
	return (
		<div className="bg-warning/10 text-warning border border-warning/30 rounded p-3 text-sm flex items-center justify-between gap-2" role="status">
			<span>{message}</span>
			<button
				type="button"
				className="bg-transparent border-none text-warning cursor-pointer px-1 text-base leading-none shrink-0"
				aria-label="Dismiss warning"
				onClick={onDismiss}
			>
				×
			</button>
		</div>
	);
}
