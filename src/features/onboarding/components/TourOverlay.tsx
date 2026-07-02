import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { measureAnchor } from "../logic/measure-anchor";
import type { TourStep } from "../logic/tour-steps";
import { TourStepCard } from "./TourStepCard";

const PAD = 8;

function prefersReducedMotion(): boolean {
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

export function TourOverlay({
	steps,
	stepIndex,
	onNext,
	onBack,
	onSkip,
}: {
	steps: readonly TourStep[];
	stepIndex: number;
	onNext: () => void;
	onBack: () => void;
	onSkip: () => void;
}) {
	const step = steps[stepIndex];
	// `undefined` = not yet measured; `null` = measured and confirmed absent.
	// Keeping those distinct stops the mount's pre-measurement render (which
	// is always `undefined`, before the layout effect below ever runs) from
	// being mistaken for a genuinely-missing anchor by the skip effect.
	const [rect, setRect] = useState<DOMRect | null | undefined>(undefined);
	const cardRef = useRef<HTMLDivElement>(null);
	// Clamped on-screen position for the step card, measured after render so a
	// tall anchor (e.g. the full sidebar tree) never pushes the card — and its
	// Next/Back controls — off the bottom of the viewport.
	const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(
		null,
	);

	const remeasure = useCallback(() => {
		setRect(step ? measureAnchor(step.anchorId) : null);
	}, [step]);

	useLayoutEffect(() => {
		remeasure();
	}, [remeasure]);

	useEffect(() => {
		window.addEventListener("resize", remeasure);
		return () => window.removeEventListener("resize", remeasure);
	}, [remeasure]);

	// Anchor missing for this step: skip it rather than wedge on a null rect.
	useEffect(() => {
		if (step && rect === null) onNext();
	}, [step, rect, onNext]);

	// Measure the card and clamp it inside the viewport: flip above the anchor
	// when it would overflow the bottom, and clamp against the right/left edges.
	useLayoutEffect(() => {
		if (!rect || !cardRef.current) {
			setCardPos(null);
			return;
		}
		const card = cardRef.current.getBoundingClientRect();
		const vw = window.innerWidth || 0;
		const vh = window.innerHeight || 0;
		let top = rect.bottom + PAD;
		if (top + card.height + PAD > vh) {
			const above = rect.top - PAD - card.height;
			top = above >= PAD ? above : Math.max(PAD, vh - card.height - PAD);
		}
		let left = rect.left;
		if (left + card.width + PAD > vw) left = vw - card.width - PAD;
		setCardPos({ left: Math.max(PAD, left), top: Math.max(PAD, top) });
	}, [rect, stepIndex]);

	if (!step || !rect) return null;

	const reduce = prefersReducedMotion();

	return createPortal(
		<div
			className="fixed inset-0 z-[60]"
			data-testid="tour-overlay"
			role="dialog"
			aria-modal="true"
			aria-label={`Welcome tour: ${step.title}`}
		>
			{/* Spotlight: a transparent hole over the anchor, with a huge dimming
			    shadow around it. */}
			<div
				aria-hidden
				className="pointer-events-none absolute"
				style={{
					left: rect.left - PAD,
					top: rect.top - PAD,
					width: rect.width + PAD * 2,
					height: rect.height + PAD * 2,
					boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
					transition: reduce ? "none" : "all 120ms ease",
				}}
			/>
			<div
				ref={cardRef}
				className="absolute"
				style={{
					left: cardPos?.left ?? rect.left,
					top: cardPos?.top ?? rect.bottom + PAD,
					visibility: cardPos ? "visible" : "hidden",
				}}
			>
				<TourStepCard
					step={step}
					index={stepIndex}
					total={steps.length}
					onNext={onNext}
					onBack={onBack}
					onSkip={onSkip}
				/>
			</div>
		</div>,
		document.body,
	);
}
