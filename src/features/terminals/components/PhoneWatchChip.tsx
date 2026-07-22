import { useEffect, useState } from "react";

type Props = {
	label: string | null;
	provider: string | null;
	since: number;
};

/** `m:ss` elapsed since `since` (no leading zero on minutes). */
function formatElapsed(since: number): string {
	const totalSeconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * R2 freeze presentation (child spec §5/§6): pinned to the pane's top-right
 * while a phone watch owns it, naming the watching agent and ticking the
 * elapsed time so the desktop user can see how long the view has been
 * frozen.
 */
export function PhoneWatchChip({ label, provider, since }: Props) {
	const [elapsed, setElapsed] = useState(() => formatElapsed(since));

	useEffect(() => {
		setElapsed(formatElapsed(since));
		const id = setInterval(() => setElapsed(formatElapsed(since)), 1000);
		return () => clearInterval(id);
	}, [since]);

	return (
		<div className="shell-watch-chip" role="status">
			phone watching · {label ?? provider ?? "agent"} · {elapsed}
		</div>
	);
}
