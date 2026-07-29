// Overlay host for the shared `InsightsDashboard` surface (design spec §2
// decision 1: "expanded overlay replacing the main column, the
// review-expanded-portal pattern"). A slimmed sibling of
// `ReviewExpandedPortal` (src/features/review/components/ReviewExpandedPortal.tsx):
// same `createPortal` + `mainColRef` rect-measuring technique, but there is no
// chip-bar handle to dock under and no slide-in/out animation — App mounts
// this component only while `insightsOpen` is true, so open/close is a plain
// mount/unmount.
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InsightsDashboard } from "./InsightsDashboard.js";
import type { WorkspaceIndex } from "./workspaceRows.js";

interface PortalRect {
	top: number;
	left: number;
	right: number;
	bottom: number;
}

const ZERO_RECT: PortalRect = { top: 0, left: 0, right: 0, bottom: 0 };

// InsightsDashboard's `onReattach` is only ever invoked from the "window"
// host's titlebar (never rendered for host="overlay"), but the prop is
// required regardless — a stable no-op keeps the contract satisfied without
// allocating a new function every render.
function noopReattach(): void {}

export interface InsightsOverlayProps {
	mainColRef: React.RefObject<HTMLElement | null>;
	workspaces: WorkspaceIndex;
	onClose: () => void;
	onDetach: () => void;
	onOpenSettings: () => void;
}

/**
 * Measures `mainColRef`'s rect and portals a fixed-position container over it
 * that fully covers the main column, hosting `<InsightsDashboard host="overlay" />`.
 * Escape closes it (scoped to keypresses originating inside the overlay, same
 * as the review portal's handler, so Esc used elsewhere in the app — context
 * menus, nested editor modals, the terminal — is unaffected).
 */
export function InsightsOverlay({
	mainColRef,
	workspaces,
	onClose,
	onDetach,
	onOpenSettings,
}: InsightsOverlayProps): React.ReactElement {
	const portalRef = useRef<HTMLDivElement>(null);
	const [rect, setRect] = useState<PortalRect>(ZERO_RECT);
	const rectRef = useRef<PortalRect>(ZERO_RECT);

	function recomputePosition() {
		const mainCol = mainColRef.current;
		if (!mainCol) return;
		const mainRect = mainCol.getBoundingClientRect();
		const next: PortalRect = {
			top: mainRect.top,
			left: mainRect.left,
			right: window.innerWidth - mainRect.right,
			bottom: window.innerHeight - mainRect.bottom,
		};
		const prev = rectRef.current;
		if (
			next.top === prev.top &&
			next.left === prev.left &&
			next.right === prev.right &&
			next.bottom === prev.bottom
		)
			return;
		rectRef.current = next;
		setRect(next);
	}

	// Runs on every render — catches position-only shifts (e.g. an update
	// banner pushing the main column down) that ResizeObserver alone misses.
	// The equality guard in recomputePosition prevents an infinite loop.
	useLayoutEffect(() => {
		recomputePosition();
	});

	useEffect(() => {
		const mainCol = mainColRef.current;
		if (!mainCol) return;
		const observer = new ResizeObserver(recomputePosition);
		observer.observe(mainCol);
		window.addEventListener("resize", recomputePosition);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", recomputePosition);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Focus the portal root on mount so the scoped Escape handler below has
	// something to scope TO: nothing else moves focus into the overlay (the
	// chip-bar button that opened it keeps focus, behind the now-hidden main
	// column; the palette input unmounts on select, leaving focus on
	// document.body), so without this Escape would never satisfy
	// `portal.contains(event.target)`. Also gives keyboard users an entry
	// point into the overlay's own tab order (tabIndex=-1 makes the div
	// programmatically focusable without adding it to the Tab sequence).
	useEffect(() => {
		portalRef.current?.focus();
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			const portal = portalRef.current;
			if (!portal || !portal.contains(event.target as Node)) return;
			event.preventDefault();
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	const content = (
		<div
			ref={portalRef}
			className="insights-overlay"
			tabIndex={-1}
			style={{
				position: "fixed",
				top: rect.top,
				left: rect.left,
				right: rect.right,
				bottom: rect.bottom,
				zIndex: 30,
				// Full-size host (spec §2 decision 1, v5): flex row + the shell's
				// flex:1/stretch make the dashboard fill the main-column rect —
				// no centering, no card. Scrolling under the chart min-height
				// floors happens INSIDE the shell (.idb-body), so this container
				// never scrolls; hidden guards against transient overflow.
				overflow: "hidden",
				display: "flex",
				padding: "var(--space-4)",
				background: "var(--background)",
			}}
		>
			<InsightsDashboard
				host="overlay"
				workspaces={workspaces}
				onClose={onClose}
				onDetach={onDetach}
				onReattach={noopReattach}
				onOpenSettings={onOpenSettings}
			/>
		</div>
	);

	return createPortal(content, document.body);
}
