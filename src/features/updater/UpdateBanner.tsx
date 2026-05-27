import "./UpdateBanner.css";
import type { UpdateInfo } from "../../../shared/contracts/commands";

interface Props {
	/** A newer version currently downloading in the background, if any. */
	downloadingInfo: UpdateInfo | null;
	/** A version that finished downloading and is ready to install, if any. */
	downloadedInfo: UpdateInfo | null;
	onRestart: () => void;
	onLater: () => void;
}

export function UpdateBanner({
	downloadingInfo,
	downloadedInfo,
	onRestart,
	onLater,
}: Props) {
	if (downloadedInfo) {
		return (
			<div className="update-banner" role="status" aria-live="polite">
				<span className="update-banner__text">
					Update <strong>{downloadedInfo.version}</strong> ready.
				</span>
				<button
					type="button"
					className="update-banner__download"
					onClick={onRestart}
				>
					Restart now
				</button>
				<button
					type="button"
					className="update-banner__close"
					onClick={onLater}
				>
					Later
				</button>
			</div>
		);
	}
	if (downloadingInfo) {
		return (
			<div className="update-banner" role="status" aria-live="polite">
				<span className="update-banner__text">
					Downloading update <strong>{downloadingInfo.version}</strong>…
				</span>
			</div>
		);
	}
	return null;
}
