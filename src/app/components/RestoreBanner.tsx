import { XIcon } from "@phosphor-icons/react";

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
		<div className="shell-restore-warning" role="status">
			<span>{message}</span>
			<button
				type="button"
				className="shell-restore-warning__dismiss"
				aria-label="Dismiss warning"
				onClick={onDismiss}
			>
				<XIcon size={12} weight="regular" aria-hidden="true" />
			</button>
		</div>
	);
}
