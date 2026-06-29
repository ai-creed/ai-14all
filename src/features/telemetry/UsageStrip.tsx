import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { UsageSnapshot } from "../../../shared/models/usage.js";
import { formatTokens, formatUsd } from "./format.js";
import { UsageChart } from "./UsageChart.js";
import { UsagePopover } from "./UsagePopover.js";

function setChipRange(range: "week" | "month"): void {
	void window.ai14all?.usage?.setChipRange(range);
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
			if (caretRef.current?.contains(t) || popoverRef.current?.contains(t))
				return;
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
	const chipRange = snapshot.config.chipRange;
	const scope = snapshot.scopes[chipRange];
	const totalTokens = scope.totalTokens;
	const totalCost = scope.cost.total;
	return (
		<div className="usage-strip">
			<span className="usage-range" role="group" aria-label="range">
				<button
					className={chipRange === "week" ? "on" : ""}
					aria-pressed={chipRange === "week"}
					onClick={() => setChipRange("week")}
				>
					W
				</button>
				<button
					className={chipRange === "month" ? "on" : ""}
					aria-pressed={chipRange === "month"}
					onClick={() => setChipRange("month")}
				>
					M
				</button>
			</span>
			<UsageChart
				kind="daily"
				daily={snapshot.seriesDaily}
				providers={snapshot.providers}
				range={chipRange}
				nowMs={snapshot.generatedAtMs}
				height={28}
			/>
			<span className="usage-figure">
				<span className="usage-figure-tok">{formatTokens(totalTokens)}</span>
				<span className="usage-figure-cost">~{formatUsd(totalCost)}</span>
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
