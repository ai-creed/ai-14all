import { useCallback, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

const REVIEW_RAIL_MIN = 240;
const REVIEW_RAIL_MAX = 520;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;

type Dimensions = {
	reviewRailWidth: number;
	sidebarWidth: number;
};

type Setters = {
	setReviewRailWidth: (n: number) => void;
	setSidebarWidth: (n: number) => void;
};

type ResizeHandlers = {
	handleReviewRailResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
	handleSidebarResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

export type UsePaneResizers = Dimensions & Setters & ResizeHandlers;

export function usePaneResizers(initial: {
	reviewRailWidth?: number;
	sidebarWidth?: number;
}): UsePaneResizers {
	const [reviewRailWidth, setReviewRailWidth] = useState(
		initial.reviewRailWidth ?? 320,
	);
	const [sidebarWidth, setSidebarWidth] = useState(initial.sidebarWidth ?? 240);

	const handleReviewRailResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = reviewRailWidth;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const nextWidth = Math.min(
					REVIEW_RAIL_MAX,
					Math.max(REVIEW_RAIL_MIN, startWidth + (moveEvent.clientX - startX)),
				);
				setReviewRailWidth(nextWidth);
			};
			const handleMouseUp = () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
			};
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		},
		[reviewRailWidth],
	);

	const handleSidebarResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = sidebarWidth;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const nextWidth = Math.min(
					SIDEBAR_MAX,
					Math.max(SIDEBAR_MIN, startWidth + (moveEvent.clientX - startX)),
				);
				setSidebarWidth(nextWidth);
			};
			const handleMouseUp = () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
			};
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		},
		[sidebarWidth],
	);

	return {
		reviewRailWidth,
		sidebarWidth,
		setReviewRailWidth,
		setSidebarWidth,
		handleReviewRailResizeStart,
		handleSidebarResizeStart,
	};
}
