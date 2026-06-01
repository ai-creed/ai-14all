import type { UpdateInfo } from "../../../shared/contracts/commands";

interface Props {
	/** A newer version currently downloading in the background, if any. */
	downloadingInfo: UpdateInfo | null;
	/** A version that finished downloading and is ready to install, if any. */
	downloadedInfo: UpdateInfo | null;
	onRestart: () => void;
	onLater: () => void;
}

const btnBase =
	"bg-transparent text-inherit border border-[var(--accent)] rounded-sm cursor-pointer font-[inherit] hover:bg-[var(--accent)] hover:text-[var(--panel-bg)]";

export function UpdateBanner({
	downloadingInfo,
	downloadedInfo,
	onRestart,
	onLater,
}: Props) {
	if (downloadedInfo) {
		return (
			<div
				className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] bg-[var(--panel-bg-elevated)] border-b border-[var(--accent)] text-[var(--text-primary)] text-sm"
				role="status"
				aria-live="polite"
			>
				<span className="flex-1">
					Update <strong>{downloadedInfo.version}</strong> ready.
				</span>
				<button
					type="button"
					className={`${btnBase} px-3 py-1`}
					onClick={onRestart}
				>
					Restart now
				</button>
				<button
					type="button"
					className={`${btnBase} border-transparent px-2 py-1 leading-none`}
					onClick={onLater}
				>
					Later
				</button>
			</div>
		);
	}
	if (downloadingInfo) {
		return (
			<div
				className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] bg-[var(--panel-bg-elevated)] border-b border-[var(--accent)] text-[var(--text-primary)] text-sm"
				role="status"
				aria-live="polite"
			>
				<span className="flex-1">
					Downloading update <strong>{downloadingInfo.version}</strong>…
				</span>
			</div>
		);
	}
	return null;
}
