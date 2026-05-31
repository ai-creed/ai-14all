import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import type { ReviewMode } from "../../../../shared/models/worktree-session";
import { ReviewBarButton } from "./ReviewBarButton";

interface PortalRect {
	top: number;
	left: number;
	right: number;
}

export interface ReviewExpandedPortalHandle {
	collapse(): void;
}

const MODE_LABEL: Record<ReviewMode, string> = {
	files: "Files",
	changes: "Changes",
	commits: "Commits",
};

interface ReviewExpandedPortalProps {
	mainColRef: React.RefObject<HTMLElement | null>;
	chipBarRef: React.RefObject<HTMLElement | null>;
	onCollapse: () => void;
	onRefresh: () => void;
	reviewMode: ReviewMode;
	isDirty: boolean;
	changedFileCount: number;
	commentSidebarOpen?: boolean;
	onToggleCommentSidebar?: () => void;
	openCommentCount?: number | null;
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
		reviewMode,
		isDirty,
		changedFileCount,
		commentSidebarOpen,
		onToggleCommentSidebar,
		openCommentCount,
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

	// Runs on every render — catches position-only shifts (e.g. a sidebar
	// width change moving the main column, since the chip bar now lives in the
	// full-width app bar) that ResizeObserver misses. The equality guard in
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

	const handleCollapse = useCallback(() => {
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
		// still call onCollapse after the transition duration + margin.
		// Setting ref to null before calling onCollapse acts as the "handled" sentinel
		// so a late transitionend cannot double-call.
		collapseTimerRef.current = setTimeout(() => {
			collapseTimerRef.current = null;
			onCollapse();
		}, 300);
		el.addEventListener(
			"transitionend",
			() => {
				if (collapseTimerRef.current === null) return; // timeout already fired
				clearTimeout(collapseTimerRef.current);
				collapseTimerRef.current = null;
				onCollapse();
			},
			{ once: true },
		);
	}, [onCollapse]);

	useImperativeHandle(ref, () => ({ collapse: handleCollapse }), [
		handleCollapse,
	]);

	// Esc collapses the overlay (like the collapse button and the Note drawer),
	// but only when the keypress originates from within the overlay — i.e. the
	// drawer is the active surface. Esc used elsewhere (dismissing a context
	// menu, closing a nested editor modal portaled to the body, or working in
	// the terminal/sidebar) must not collapse it. defaultPrevented (e.g. Monaco
	// swallowing Esc) is also respected.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			const portal = portalRef.current;
			if (!portal || !portal.contains(event.target as Node)) return;
			event.preventDefault();
			handleCollapse();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [handleCollapse]);

	const content = (
		<div
			ref={portalRef}
			className="fixed inset-x-0 bottom-0 z-[49] flex flex-col bg-background border-t border-[var(--pane-border-review)] transition-transform duration-200"
			data-testid="review-expanded-portal"
			data-leaving={leaving ? "true" : undefined}
			style={{ top: rect.top, left: rect.left, right: rect.right }}
		>
			{/* Header mirrors the collapsed `ReviewChipBar` layout (same class names,
			    same vertical rhythm) so the two states look identical apart from
			    the trailing toggle button. */}
			<div className="flex items-center h-9 px-3 gap-2 border-b border-[var(--pane-border-review)]">
				<span className="text-[10px] uppercase tracking-wider text-muted-foreground">REVIEW</span>
				<span className="text-xs font-medium text-foreground">
					{MODE_LABEL[reviewMode]}
				</span>
				{isDirty ? (
					<span
						className="text-xs text-muted-foreground"
						data-state="dirty"
						aria-label={`${changedFileCount} changed files`}
					>
						{changedFileCount} changed
					</span>
				) : (
					<span
						className="text-xs text-muted-foreground"
						data-state="clean"
						aria-label="Clean — no changes"
					>
						✓ clean
					</span>
				)}
				<span className="flex-1" />
				{onToggleCommentSidebar &&
					openCommentCount !== null &&
					openCommentCount !== undefined && (
						<ReviewBarButton
							icon="💬"
							label={commentSidebarOpen ? "Hide comments" : "Comments"}
							ariaLabel={commentSidebarOpen ? "Hide comments" : "Show comments"}
							title={commentSidebarOpen ? "Hide comments" : "Show comments"}
							onClick={onToggleCommentSidebar}
						/>
					)}
				<ReviewBarButton
					icon="↻"
					label="Refresh"
					ariaLabel="Refresh review"
					title="Refresh review"
					onClick={onRefresh}
				/>
				<ReviewBarButton
					icon="⬇"
					label="Collapse"
					ariaLabel="Collapse full review"
					title="Collapse full review"
					onClick={handleCollapse}
				/>
			</div>
			<div className="min-h-0 grid flex-1">{children}</div>
		</div>
	);

	return createPortal(content, document.body);
});
