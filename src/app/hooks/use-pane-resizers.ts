import { useCallback, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

const REVIEW_RAIL_MIN = 240;
const REVIEW_RAIL_MAX = 520;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const REVIEW_PANEL_MIN = 160;

type Dimensions = {
	reviewRailWidth: number;
	reviewPanelHeight: number;
	sidebarWidth: number;
};

type Setters = {
	setReviewRailWidth: (n: number) => void;
	setReviewPanelHeight: (n: number) => void;
	setSidebarWidth: (n: number) => void;
};

type ResizeHandlers = {
	handleReviewRailResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
	handleSidebarResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
	handleReviewPanelResizeStart: (
		event: ReactMouseEvent<HTMLDivElement>,
	) => void;
};

export type UsePaneResizers = Dimensions & Setters & ResizeHandlers;

export function usePaneResizers(initial: {
	reviewRailWidth?: number;
	reviewPanelHeight?: number;
	sidebarWidth?: number;
}): UsePaneResizers {
	const [reviewRailWidth, setReviewRailWidth] = useState(
		initial.reviewRailWidth ?? 320,
	);
	const [reviewPanelHeight, setReviewPanelHeight] = useState(
		initial.reviewPanelHeight ?? 280,
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

	const handleReviewPanelResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startY = event.clientY;
			const startHeight = reviewPanelHeight;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const maxHeight = Math.max(REVIEW_PANEL_MIN, window.innerHeight - 320);
				// Moving the handle upward increases review height; moving it
				// downward decreases review height and gives space back to the
				// terminal. Keep the subtraction form explicit so unit and e2e
				// expectations stay aligned.
				const nextHeight = Math.min(
					maxHeight,
					Math.max(
						REVIEW_PANEL_MIN,
						startHeight - (moveEvent.clientY - startY),
					),
				);
				setReviewPanelHeight(nextHeight);
			};
			const handleMouseUp = () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
			};
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		},
		[reviewPanelHeight],
	);

	return {
		reviewRailWidth,
		reviewPanelHeight,
		sidebarWidth,
		setReviewRailWidth,
		setReviewPanelHeight,
		setSidebarWidth,
		handleReviewRailResizeStart,
		handleSidebarResizeStart,
		handleReviewPanelResizeStart,
	};
}
