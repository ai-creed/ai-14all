import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { UsageSnapshot } from "../../../shared/models/usage.js";
import { formatTokens, formatUsd } from "./format.js";
import { providerRollup } from "./rollup.js";
import { UsageChart } from "./UsageChart.js";
import { UsagePopover } from "./UsagePopover.js";

function setRange(range: "week" | "month"): void {
	void window.ai14all?.usage?.setRange(range);
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
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			const t = e.target as Node;
			if (caretRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
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
	const providers = snapshot.providers ?? [];
	const series = snapshot.series ?? [];
	const range = snapshot.config.range ?? "week";
	const nowMs = snapshot.generatedAtMs;
	const { totalTokens, totalCost } = providerRollup(series, range, snapshot.cost ?? null, nowMs);
	return (
		<div className="usage-strip">
			<span className="usage-range" role="group" aria-label="range">
				<button className={range === "week" ? "on" : ""} aria-pressed={range === "week"} onClick={() => setRange("week")}>W</button>
				<button className={range === "month" ? "on" : ""} aria-pressed={range === "month"} onClick={() => setRange("month")}>M</button>
			</span>
			<UsageChart series={series} providers={providers} range={range} nowMs={nowMs} height={28} />
			<span className="usage-figure">
				<span className="usage-figure-tok">{formatTokens(totalTokens)}</span>
				{snapshot.cost ? (
					<span className="usage-figure-cost" title="notional API-equivalent value since launch">
						~{formatUsd(totalCost ?? 0)}
					</span>
				) : null}
			</span>
			<button
				ref={caretRef}
				className="usage-caret"
				aria-label="Open token breakdown"
				onClick={() => setOpen((v) => !v)}
			>
				▾
			</button>
			{open &&
				createPortal(
					<UsagePopover
						snapshot={snapshot}
						onClose={() => setOpen(false)}
						style={anchorStyle(caretRef.current)}
						rootRef={popoverRef}
						openWorktreePaths={openWorktreePaths}
						currentWorktreePath={currentWorktreePath}
					/>,
					document.body,
				)}
		</div>
	);
}

function anchorStyle(el: HTMLElement | null): CSSProperties {
	const r = el?.getBoundingClientRect();
	if (!r) return { position: "fixed", top: 56, right: 12 };
	return {
		position: "fixed",
		top: r.bottom + 6,
		right: Math.max(8, window.innerWidth - r.right),
	};
}
