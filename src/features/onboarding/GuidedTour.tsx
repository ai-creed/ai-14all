import { useEffect, useState } from "react";
import { XIcon } from "@phosphor-icons/react";

const TOUR_STEPS = [
	{
		anchor: '[data-tour="sidebar"]',
		side: "right",
		align: "start",
		title: "Sessions live here",
		body: "Each row is one agent's session. It owns its own git branch and worktree, so multiple agents can work in parallel without colliding.",
	},
	{
		anchor: '[data-tour="chipbar"]',
		side: "bottom",
		align: "start",
		title: "Session controls",
		body: "Files, the session note, and the review surface live in this bar. Click the ? on the right for shortcuts and docs anytime.",
	},
	{
		anchor: '[data-tour="terminal"]',
		side: "top",
		align: "center",
		title: "Run your agent in the terminal",
		body: "Type `claude` or `codex` (or your preset) to launch an agent. Press ⌘T to add another shell to the same session.",
	},
	{
		anchor: '[data-tour="layout"]',
		side: "bottom",
		align: "end",
		title: "Split-screen when you need it",
		body: "Press ⌘⇧L to pick a layout for running multiple agents side-by-side in the same session.",
	},
] as const;

type Props = {
	/** Whether to start showing the tour. Caller decides timing (e.g. after the
	 * first session is created and the chrome is rendered). */
	active: boolean;
	onComplete: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

/**
 * Lightweight 4-stop coachmark tour. Anchors a card to each step's target via
 * `data-tour` attribute. No tour library — uses bare DOM rect lookup and CSS
 * positioning. Targets the chrome rendered by SidebarPanel, SessionChipBar,
 * TerminalPanel, and TerminalActions.
 *
 * If a target isn't found (e.g. the user is on a screen that hasn't rendered
 * it yet), that step is skipped — the tour fails-safe rather than blocking.
 */
export function GuidedTour({ active, onComplete }: Props) {
	const [stepIdx, setStepIdx] = useState(0);
	const [rect, setRect] = useState<Rect | null>(null);

	useEffect(() => {
		if (!active) return;
		let cancelled = false;
		const measure = () => {
			if (cancelled) return;
			const step = TOUR_STEPS[stepIdx];
			if (!step) return;
			const el = document.querySelector(step.anchor);
			if (!el) {
				// Target not on screen — skip this step, advance.
				setStepIdx((i) => i + 1);
				return;
			}
			const r = el.getBoundingClientRect();
			setRect({
				top: r.top + window.scrollY,
				left: r.left + window.scrollX,
				width: r.width,
				height: r.height,
			});
		};
		// Initial measure after the next paint so layout settles.
		const raf = requestAnimationFrame(measure);
		window.addEventListener("resize", measure);
		return () => {
			cancelled = true;
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", measure);
		};
	}, [active, stepIdx]);

	useEffect(() => {
		if (stepIdx >= TOUR_STEPS.length) onComplete();
	}, [stepIdx, onComplete]);

	if (!active) return null;
	const step = TOUR_STEPS[stepIdx];
	if (!step || !rect) return null;

	const cardStyle = anchorStyle(rect, step.side);

	return (
		<>
			<div className="shell-tour__backdrop" onClick={onComplete} />
			<div
				className="shell-tour__highlight"
				style={{
					top: rect.top - 4,
					left: rect.left - 4,
					width: rect.width + 8,
					height: rect.height + 8,
				}}
			/>
			<div className="shell-tour__card" style={cardStyle} role="dialog">
				<button
					type="button"
					className="shell-tour__close"
					aria-label="Skip tour"
					onClick={onComplete}
				>
					<XIcon size={12} weight="regular" aria-hidden="true" />
				</button>
				<div className="shell-tour__title">{step.title}</div>
				<div className="shell-tour__body">{step.body}</div>
				<div className="shell-tour__footer">
					<span className="shell-tour__progress">
						{stepIdx + 1} / {TOUR_STEPS.length}
					</span>
					<button
						type="button"
						className="shell-button shell-button--compact"
						onClick={onComplete}
					>
						Skip
					</button>
					<button
						type="button"
						className="shell-button shell-button--compact shell-button--primary"
						onClick={() => setStepIdx((i) => i + 1)}
					>
						{stepIdx === TOUR_STEPS.length - 1 ? "Finish" : "Next"}
					</button>
				</div>
			</div>
		</>
	);
}

function anchorStyle(rect: Rect, side: string): React.CSSProperties {
	const GAP = 12;
	const CARD_W = 280;
	const CARD_H_EST = 160;
	switch (side) {
		case "right":
			return {
				top: Math.max(8, rect.top),
				left: rect.left + rect.width + GAP,
			};
		case "left":
			return {
				top: Math.max(8, rect.top),
				left: Math.max(8, rect.left - CARD_W - GAP),
			};
		case "top":
			return {
				top: Math.max(8, rect.top - CARD_H_EST - GAP),
				left: Math.max(8, rect.left + rect.width / 2 - CARD_W / 2),
			};
		case "bottom":
		default:
			return {
				top: rect.top + rect.height + GAP,
				left: Math.max(8, rect.left),
			};
	}
}
