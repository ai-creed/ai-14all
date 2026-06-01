import { ChevronDown, ArrowUp, ArrowDown } from "lucide-react";
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
	installedProviders,
}: {
	snapshot: UsageSnapshot | null;
	currentWorktreePath: string | null;
	openWorktreePaths?: string[];
	/** Telemetry providers whose CLI is installed; null = not yet known (show all). */
	installedProviders?: UsageProvider[] | null;
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
	const visible =
		installedProviders == null
			? ORDER
			: ORDER.filter((p) => installedProviders.includes(p));
	return (
		<div className="relative flex items-center gap-2 font-mono">
			<div className="grid grid-cols-[auto_auto_auto_auto] gap-x-2.5 gap-y-0.5 items-center text-xs tabular-nums">
				{visible.map((provider) => {
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
								className="inline-flex items-center gap-1.5"
								title="↑ prompt tokens sent · ↓ tokens generated"
							>
								<span className="inline-flex items-center gap-0.5 text-foreground font-semibold">
									<ArrowUp className="h-3 w-3" aria-hidden="true" />
									{formatTokens(t.input)}
								</span>
								<span className="inline-flex items-center gap-0.5 text-muted-foreground">
									<ArrowDown className="h-3 w-3" aria-hidden="true" />
									{formatTokens(t.output)}
								</span>
							</span>
							<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
								<span className="text-[10px] tracking-wide uppercase text-muted-foreground">
									5h
								</span>
								<Gauge percent={g?.fiveHour.percent ?? 0} cells={12} />
								<span className="min-w-[3ch] text-right">
									{g?.fiveHour.percent ?? 0}%
								</span>
							</span>
							<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
								<span className="text-[10px] tracking-wide uppercase text-muted-foreground">
									wk
								</span>
								<Gauge percent={g?.weekly.percent ?? 0} cells={12} />
								<span className="min-w-[3ch] text-right">
									{g?.weekly.percent ?? 0}%
								</span>
							</span>
						</div>
					);
				})}
			</div>
			<button
				ref={caretRef}
				className="bg-transparent border-none text-muted-foreground cursor-pointer text-sm"
				aria-label="Open token breakdown"
				onClick={() => setOpen((v) => !v)}
			>
				<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
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
