import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import type { Coachmark as CoachmarkDef } from "../logic/coachmarks";
import { measureAnchor } from "../logic/measure-anchor";
import { CoachmarkCard } from "./CoachmarkCard";

const GAP = 8;

export function Coachmark({
	coachmark,
	onDismiss,
}: {
	coachmark: CoachmarkDef;
	onDismiss: (id: string) => void;
}) {
	const [rect, setRect] = useState<DOMRect | null>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	// Clamped on-screen position, measured after render so a bottom-pinned anchor
	// (e.g. the sidebar settings footer) or a right-aligned chip never renders the
	// card off-screen where it would be invisible and un-dismissable.
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

	const remeasure = useCallback(() => {
		setRect(measureAnchor(coachmark.anchorId));
	}, [coachmark.anchorId]);

	useLayoutEffect(() => {
		remeasure();
	}, [remeasure]);

	useEffect(() => {
		window.addEventListener("resize", remeasure);
		return () => window.removeEventListener("resize", remeasure);
	}, [remeasure]);

	// Flip above the anchor when the card would overflow the bottom, and clamp
	// against the left/right edges.
	useLayoutEffect(() => {
		if (!rect || !cardRef.current) {
			setPos(null);
			return;
		}
		const card = cardRef.current.getBoundingClientRect();
		const vw = window.innerWidth || 0;
		const vh = window.innerHeight || 0;
		let top = rect.bottom + GAP;
		if (top + card.height + GAP > vh) {
			const above = rect.top - GAP - card.height;
			top = above >= GAP ? above : Math.max(GAP, vh - card.height - GAP);
		}
		let left = rect.left;
		if (left + card.width + GAP > vw) left = vw - card.width - GAP;
		setPos({ left: Math.max(GAP, left), top: Math.max(GAP, top) });
	}, [rect]);

	if (rect === null) return null;

	return createPortal(
		<div
			ref={cardRef}
			className="fixed z-50"
			style={{
				left: pos?.left ?? rect.left,
				top: pos?.top ?? rect.bottom + GAP,
				visibility: pos ? "visible" : "hidden",
			}}
		>
			<CoachmarkCard
				title={coachmark.title}
				body={coachmark.body}
				onDismiss={() => onDismiss(coachmark.id)}
			/>
		</div>,
		document.body,
	);
}
