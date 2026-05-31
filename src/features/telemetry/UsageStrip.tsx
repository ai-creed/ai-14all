import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
		<div className="relative flex items-center gap-2.5 font-mono">
			<div className="grid grid-cols-[auto_auto_auto_auto] gap-x-3 gap-y-0.5 items-center text-[11px]">
				{ORDER.map((provider) => {
					const t = rowTotals(snapshot, provider, currentWorktreePath);
					const g = gaugeFor(provider);
					return (
						<div className="contents" key={provider}>
							<span
								className={`font-semibold ${provider === "claude" ? "text-[var(--provider-claude)]" : "text-[var(--provider-codex)]"}`}
							>
								{provider}
							</span>
							<span
								className="text-foreground"
								title="↑ prompt tokens sent · ↓ tokens generated"
							>
								<span className="text-foreground font-semibold">
									↑{formatTokens(t.input)}
								</span>{" "}
								<span className="text-muted-foreground">
									↓{formatTokens(t.output)}
								</span>
							</span>
							<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
								<span className="text-[9px] tracking-wide uppercase text-muted-foreground">
									5h
								</span>
								<Gauge percent={g?.fiveHour.percent ?? 0} />{" "}
								{g?.fiveHour.percent ?? 0}%
							</span>
							<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
								<span className="text-[9px] tracking-wide uppercase text-muted-foreground">
									wk
								</span>
								<Gauge percent={g?.weekly.percent ?? 0} />{" "}
								{g?.weekly.percent ?? 0}%
							</span>
						</div>
					);
				})}
			</div>
			<button
				ref={caretRef}
				className="bg-transparent border-none text-muted-foreground cursor-pointer text-[13px]"
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
