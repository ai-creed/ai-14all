import "./UpdateBanner.css";
import type { UpdateInfo } from "../../../shared/contracts/commands";

interface Props {
	info: UpdateInfo | null;
	onDownload: (url: string) => void;
	onDismiss: () => void;
}

export function UpdateBanner({ info, onDownload, onDismiss }: Props) {
	if (!info) return null;
	return (
		<div className="update-banner" role="status" aria-live="polite">
			<span className="update-banner__text">
				Version <strong>{info.version}</strong> available.
			</span>
			<button
				type="button"
				className="update-banner__download"
				onClick={() => onDownload(info.url)}
			>
				Download
			</button>
			<button
				type="button"
				className="update-banner__close"
				aria-label="Dismiss update notification"
				onClick={onDismiss}
			>
				×
			</button>
		</div>
	);
}
