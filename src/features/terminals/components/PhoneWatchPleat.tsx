import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";

export type PleatPreviewFactory = (
	container: HTMLElement,
	cols: number,
	rows: number,
	bytes: string,
) => { dispose: () => void };

/**
 * Read-only xterm preview of the narrow-epoch bytes captured during a phone
 * watch. Not exercised by unit tests (those inject a stub factory) — real
 * xterm is not viable in jsdom.
 */
const defaultPreviewFactory: PleatPreviewFactory = (
	container,
	cols,
	rows,
	bytes,
) => {
	const term = new Terminal({
		cols,
		rows,
		disableStdin: true,
		fontSize: 11,
		scrollback: 2000,
	});
	term.open(container);
	term.write(bytes);
	return { dispose: () => term.dispose() };
};

function formatTime(ms: number): string {
	return new Date(ms).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

type Props = {
	from: number;
	to: number | null;
	cols: number;
	rows: number;
	readBytes: () => string;
	onDismiss: () => void;
	/** default: real read-only xterm; tests inject a stub */
	createPreview?: PleatPreviewFactory;
};

/**
 * R2 freeze presentation (child spec §5/§6): a bar anchored at the pane's
 * bottom edge summarizing a past (or in-progress) phone watch's time range,
 * with an optional expanded preview of the narrow-epoch bytes captured
 * during it.
 */
export function PhoneWatchPleat({
	from,
	to,
	cols,
	rows,
	readBytes,
	onDismiss,
	createPreview = defaultPreviewFactory,
}: Props) {
	const [expanded, setExpanded] = useState(false);
	const previewRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!expanded) return;
		const container = previewRef.current;
		if (!container) return;
		const preview = createPreview(container, cols, rows, readBytes());
		return () => preview.dispose();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [expanded]);

	const range = `phone watched ${formatTime(from)}–${to === null ? "…" : formatTime(to)}`;

	return (
		<div className="shell-watch-pleat">
			<span className="shell-watch-pleat__range">{range}</span>
			<button type="button" onClick={() => setExpanded((v) => !v)}>
				{expanded ? "Collapse" : "Expand"}
			</button>
			<button type="button" onClick={onDismiss}>
				Dismiss
			</button>
			{expanded && (
				<div ref={previewRef} className="shell-watch-pleat__preview" />
			)}
		</div>
	);
}
