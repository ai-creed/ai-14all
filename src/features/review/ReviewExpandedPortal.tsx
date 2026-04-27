import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

interface PortalRect {
	top: number;
	left: number;
	right: number;
}

export interface ReviewExpandedPortalHandle {
	collapse(): void;
}

interface ReviewExpandedPortalProps {
	mainColRef: React.RefObject<HTMLElement | null>;
	chipBarRef: React.RefObject<HTMLElement | null>;
	onCollapse: () => void;
	onRefresh: () => void;
	isDirty: boolean;
	changedFileCount: number;
	children: React.ReactNode;
}

export const ReviewExpandedPortal = forwardRef<
	ReviewExpandedPortalHandle,
	ReviewExpandedPortalProps
>(function ReviewExpandedPortal(
	{
		mainColRef,
		chipBarRef,
		onCollapse,
		onRefresh,
		isDirty,
		changedFileCount,
		children,
	},
	ref,
) {
	const portalRef = useRef<HTMLDivElement>(null);
	const [rect, setRect] = useState<PortalRect>({ top: 0, left: 0, right: 0 });
	const rectRef = useRef<PortalRect>({ top: 0, left: 0, right: 0 });

	// Start in leaving state so the first render is off-screen; rAF below removes it.
	const [leaving, setLeaving] = useState(true);
	const entryRafRef = useRef<number | null>(null);
	const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	function recomputePosition() {
		const mainCol = mainColRef.current;
		const chipBar = chipBarRef.current;
		if (!mainCol || !chipBar) return;
		const mainRect = mainCol.getBoundingClientRect();
		const chipRect = chipBar.getBoundingClientRect();
		const next: PortalRect = {
			top: chipRect.bottom,
			left: mainRect.left,
			right: window.innerWidth - mainRect.right,
		};
		const prev = rectRef.current;
		if (
			next.top === prev.top &&
			next.left === prev.left &&
			next.right === prev.right
		)
			return;
		rectRef.current = next;
		setRect(next);
	}

	// Runs on every render — catches position-only shifts (e.g. UpdateBanner
	// pushing chip bar down) that ResizeObserver misses. The equality guard in
	// recomputePosition prevents an infinite re-render loop.
	useLayoutEffect(() => {
		recomputePosition();
	});

	useEffect(() => {
		const mainCol = mainColRef.current;
		const chipBar = chipBarRef.current;
		if (!mainCol || !chipBar) return;
		const observer = new ResizeObserver(recomputePosition);
		observer.observe(mainCol);
		observer.observe(chipBar);
		window.addEventListener("resize", recomputePosition);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", recomputePosition);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Entry animation: initial render is off-screen (leaving=true); remove on next frame.
	// Cleanup also cancels any pending collapse timer so no stale callback fires on unmount.
	useEffect(() => {
		entryRafRef.current = requestAnimationFrame(() => {
			setLeaving(false);
			entryRafRef.current = null;
		});
		return () => {
			if (entryRafRef.current !== null)
				cancelAnimationFrame(entryRafRef.current);
			if (collapseTimerRef.current !== null)
				clearTimeout(collapseTimerRef.current);
		};
	}, []);

	function handleCollapse() {
		const el = portalRef.current;
		if (!el) {
			onCollapse();
			return;
		}
		// Cancel entry rAF if still pending — otherwise setting leaving=true would be
		// a no-op (it's already true) and the transition never starts.
		if (entryRafRef.current !== null) {
			cancelAnimationFrame(entryRafRef.current);
			entryRafRef.current = null;
		}
		setLeaving(true);
		// Fallback: if transitionend never fires (reduced-motion, CSS not loaded, etc.)
		// still unmount after the transition duration + margin.
		collapseTimerRef.current = setTimeout(onCollapse, 300);
		el.addEventListener(
			"transitionend",
			() => {
				if (collapseTimerRef.current !== null) {
					clearTimeout(collapseTimerRef.current);
					collapseTimerRef.current = null;
				}
				onCollapse();
			},
			{ once: true },
		);
	}

	useImperativeHandle(ref, () => ({ collapse: handleCollapse }), []);

	const content = (
		<div
			ref={portalRef}
			className="shell-review-expanded-portal"
			data-testid="review-expanded-portal"
			data-leaving={leaving ? "true" : undefined}
			style={{ top: rect.top, left: rect.left, right: rect.right }}
		>
			<div className="shell-review-drawer__header">
				<span className="shell-label">Review</span>
				<div className="shell-review-drawer__status">
					{isDirty ? (
						<span
							className="shell-review-drawer__dirty"
							aria-label={`${changedFileCount} changed files`}
						>
							{changedFileCount} changed
						</span>
					) : (
						<span
							className="shell-review-drawer__clean"
							aria-label="Clean — no changes"
						>
							✓ clean
						</span>
					)}
				</div>
				<div className="shell-review-drawer__actions">
					<button
						type="button"
						className="shell-button shell-button--compact shell-button--icon shell-button--round"
						aria-label="Refresh review"
						title="Refresh review"
						onClick={onRefresh}
					>
						<span aria-hidden="true">↻</span>
					</button>
					<button
						type="button"
						className="shell-button shell-button--compact shell-button--icon shell-button--round"
						aria-label="Collapse full review"
						title="Collapse full review"
						data-active="true"
						onClick={handleCollapse}
					>
						<span aria-hidden="true">⬇</span>
					</button>
				</div>
			</div>
			<div className="shell-review-drawer__body">{children}</div>
		</div>
	);

	return createPortal(content, document.body);
});
