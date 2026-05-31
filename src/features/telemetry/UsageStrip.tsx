import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	CaretDownIcon,
} from "@phosphor-icons/react";
import type {
	LimitGauge,
	UsageProvider,
	UsageSnapshot,
} from "../../../shared/models/usage.js";
import { formatTokens } from "./format.js";
import { Gauge } from "./Gauge.js";
import { UsagePopover } from "./UsagePopover.js";

const ORDER: UsageProvider[] = ["claude", "codex"]; // claude over codex

function rowTotals(
	snapshot: UsageSnapshot,
	provider: UsageProvider,
	currentWorktreePath: string | null,
) {
	let input = 0;
	let output = 0;
	for (const r of snapshot.rows) {
		if (r.provider !== provider) continue;
		if (currentWorktreePath && r.worktreePath !== currentWorktreePath) continue;
		input += r.sinceLaunch.input;
		output += r.sinceLaunch.output;
	}
	return { input, output };
}

export function UsageStrip({
	snapshot,
	currentWorktreePath,
	openWorktreePaths,
}: {
	snapshot: UsageSnapshot | null;
	currentWorktreePath: string | null;
	openWorktreePaths?: string[];
}) {
	const [open, setOpen] = useState(false);
	const caretRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	// Persistent popover: stays open until the caret is toggled, Escape, or a
	// click outside it. Never closes on mouse-out.
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			const t = e.target as Node;
			if (caretRef.current?.contains(t) || popoverRef.current?.contains(t)) {
				return;
			}
			setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);
	if (!snapshot) return null;
	const gaugeFor = (p: UsageProvider): LimitGauge | undefined =>
		snapshot.limits.find((l) => l.provider === p);
	return (
		<div className="usage-strip">
			<div className="usage-tele">
				{ORDER.map((provider) => {
					const t = rowTotals(snapshot, provider, currentWorktreePath);
					const g = gaugeFor(provider);
					return (
						<div className="usage-trow" key={provider}>
							<span className={`usage-prov usage-prov--${provider}`}>
								{provider}
							</span>
							<span
								className="usage-tok"
								title="prompt tokens sent · tokens generated"
							>
								<span className="usage-bill">
									<ArrowUpIcon
										size={10}
										weight="regular"
										aria-hidden="true"
									/>
									{formatTokens(t.input)}
								</span>{" "}
								<span className="usage-raw">
									<ArrowDownIcon
										size={10}
										weight="regular"
										aria-hidden="true"
									/>
									{formatTokens(t.output)}
								</span>
							</span>
							<span className="usage-cell">
								<span className="usage-col-h">5h</span>
								<Gauge percent={g?.fiveHour.percent ?? 0} />{" "}
								{g?.fiveHour.percent ?? 0}%
							</span>
							<span className="usage-cell">
								<span className="usage-col-h">wk</span>
								<Gauge percent={g?.weekly.percent ?? 0} />{" "}
								{g?.weekly.percent ?? 0}%
							</span>
						</div>
					);
				})}
			</div>
			<button
				ref={caretRef}
				className="usage-caret"
				aria-label="Open token breakdown"
				onClick={() => setOpen((v) => !v)}
			>
				<CaretDownIcon size={12} weight="regular" aria-hidden="true" />
			</button>
			{open &&
				createPortal(
					<UsagePopover
						snapshot={snapshot}
						onClose={() => setOpen(false)}
						style={anchorStyle(caretRef.current)}
						rootRef={popoverRef}
						openWorktreePaths={openWorktreePaths}
					/>,
					document.body,
				)}
		</div>
	);
}

// Fixed-position anchor under the caret. Rendered in a portal so the dropdown
// escapes the chip bar's overflow clipping.
function anchorStyle(el: HTMLElement | null): CSSProperties {
	const r = el?.getBoundingClientRect();
	if (!r) return { position: "fixed", top: 56, right: 12 };
	return {
		position: "fixed",
		top: r.bottom + 6,
		right: Math.max(8, window.innerWidth - r.right),
	};
}
