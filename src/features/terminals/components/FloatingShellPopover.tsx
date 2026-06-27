import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ITheme } from "xterm";
import { Icon } from "@/components/ui/icon";
import type { ProcessSession } from "../../../../shared/models/process-session";
import type { TerminalSession } from "../../../../shared/models/terminal-session";
import { TerminalPane } from "./TerminalPane";
import {
	applyResize,
	type ResizeHandle,
	type Rect,
	type Size,
} from "../logic/floating-shell-resize";

export type FloatingShellPosition = { left: number; top: number };

type Props = {
	process: ProcessSession;
	session: TerminalSession | null;
	theme: ITheme;
	/** True when the grid is full (6 slots) — pin has no room to promote. */
	pinDisabled: boolean;
	onMinimize: (processId: string) => void;
	onPin: (processId: string) => void;
	onClose: (processId: string) => void;
	onTitleChange: (title: string) => void;
	/**
	 * Restored drag position for this shell (memory-only), or null to use the
	 * default header-anchored position. The popover starts here on mount.
	 */
	initialPosition?: FloatingShellPosition | null;
	/** Persist the dragged position (null when reset back to the anchor). */
	onPositionChange?: (pos: FloatingShellPosition | null) => void;
	/** Restored shared size (memory-only), or null to use the CSS default. */
	initialSize?: Size | null;
	/** Persist the resized size (null when reset back to the default). */
	onSizeChange?: (size: Size | null) => void;
};

// While dragging, keep at least this much of the popover within the viewport so
// it can always be grabbed again; the header row stays fully reachable.
const KEEP_ON_SCREEN_PX = 120;
const HEADER_KEEP_PX = 28;

/**
 * The expanded throwaway shell, a header-anchored drop-down popover over the
 * grid. Reuses TerminalPane for the body so it inherits replay-on-mount and the
 * existing xterm key handling. After the shell exits it lingers (the retained
 * replay buffer repopulates the pane) until the user dismisses it.
 *
 * Draggable by its header: the first drag switches it from the CSS anchor to a
 * fixed viewport position; double-clicking the header snaps it back. The owner
 * persists the position per shell so it survives minimize/restore.
 */
export function FloatingShellPopover({
	process,
	session,
	theme,
	pinDisabled,
	onMinimize,
	onPin,
	onClose,
	onTitleChange,
	initialPosition = null,
	onPositionChange,
	initialSize = null,
	onSizeChange,
}: Props) {
	const exited = process.status === "exited" || process.status === "error";
	const rootRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		baseLeft: number;
		baseTop: number;
	} | null>(null);
	// Latest position held in a ref so the pointer-up handler persists the exact
	// final value regardless of React render/batch timing.
	const latestPosRef = useRef<FloatingShellPosition | null>(initialPosition);
	const [pos, setPos] = useState<FloatingShellPosition | null>(initialPosition);

	const applyPos = (next: FloatingShellPosition | null) => {
		latestPosRef.current = next;
		setPos(next);
	};

	const resizeRef = useRef<{
		pointerId: number;
		handle: ResizeHandle;
		startX: number;
		startY: number;
		startRect: Rect;
	} | null>(null);
	const latestSizeRef = useRef<Size | null>(initialSize);
	const [size, setSize] = useState<Size | null>(initialSize);

	const applySize = (next: Size | null) => {
		latestSizeRef.current = next;
		setSize(next);
	};

	// Esc, or a pointer-down outside the popover, minimizes it back to its pill.
	// Both listen in the capture phase so Esc wins over xterm — which always holds
	// focus while the shell is expanded (see targetOwnsTyping/.xterm gotcha) — and
	// stopPropagation keeps it out of the terminal. The pills bar is excluded
	// because it owns its own expand/collapse.
	useEffect(() => {
		const minimize = () => onMinimize(process.id);
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			e.preventDefault();
			e.stopPropagation();
			minimize();
		};
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as HTMLElement | null;
			if (!target) return;
			if (rootRef.current?.contains(target)) return;
			if (target.closest?.(".floating-shell-pills")) return;
			minimize();
		};
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [process.id, onMinimize]);

	const clamp = (left: number, top: number): FloatingShellPosition => {
		const width = rootRef.current?.offsetWidth ?? 0;
		const minLeft = KEEP_ON_SCREEN_PX - width;
		const maxLeft = window.innerWidth - KEEP_ON_SCREEN_PX;
		const maxTop = window.innerHeight - HEADER_KEEP_PX;
		return {
			left: Math.min(Math.max(left, minLeft), maxLeft),
			top: Math.min(Math.max(top, 0), maxTop),
		};
	};

	const onHeaderPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
		// Never start a drag from a header control (pin / minimize / close).
		if ((e.target as HTMLElement).closest("button")) return;
		const rect = rootRef.current?.getBoundingClientRect();
		if (!rect) return;
		dragRef.current = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			baseLeft: rect.left,
			baseTop: rect.top,
		};
		// Switch to a fixed position at the current spot so there is no jump.
		applyPos({ left: rect.left, top: rect.top });
		e.currentTarget.setPointerCapture?.(e.pointerId);
		e.preventDefault();
	};

	const onHeaderPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== e.pointerId) return;
		applyPos(
			clamp(
				drag.baseLeft + (e.clientX - drag.startX),
				drag.baseTop + (e.clientY - drag.startY),
			),
		);
	};

	const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== e.pointerId) return;
		dragRef.current = null;
		e.currentTarget.releasePointerCapture?.(e.pointerId);
		onPositionChange?.(latestPosRef.current);
	};

	const onResizePointerDown =
		(handle: ResizeHandle) => (e: ReactPointerEvent<HTMLElement>) => {
			const rect = rootRef.current?.getBoundingClientRect();
			if (!rect) return;
			resizeRef.current = {
				pointerId: e.pointerId,
				handle,
				startX: e.clientX,
				startY: e.clientY,
				startRect: {
					left: rect.left,
					top: rect.top,
					width: rect.width,
					height: rect.height,
				},
			};
			// Anchor at the current spot so west/north edges can move the popover.
			applyPos({ left: rect.left, top: rect.top });
			applySize({ width: rect.width, height: rect.height });
			e.currentTarget.setPointerCapture?.(e.pointerId);
			e.preventDefault();
			e.stopPropagation();
		};

	const onResizePointerMove = (e: ReactPointerEvent<HTMLElement>) => {
		const rz = resizeRef.current;
		if (!rz || rz.pointerId !== e.pointerId) return;
		const next = applyResize(
			rz.handle,
			rz.startRect,
			e.clientX - rz.startX,
			e.clientY - rz.startY,
			{ width: window.innerWidth, height: window.innerHeight },
		);
		applyPos({ left: next.left, top: next.top });
		applySize({ width: next.width, height: next.height });
	};

	const endResize = (e: ReactPointerEvent<HTMLElement>) => {
		const rz = resizeRef.current;
		if (!rz || rz.pointerId !== e.pointerId) return;
		resizeRef.current = null;
		e.currentTarget.releasePointerCapture?.(e.pointerId);
		onPositionChange?.(latestPosRef.current);
		onSizeChange?.(latestSizeRef.current);
	};

	const resetPosition = () => {
		applyPos(null);
		applySize(null);
		onPositionChange?.(null);
		onSizeChange?.(null);
	};

	const dragged = pos !== null;

	return (
		<div
			ref={rootRef}
			className="floating-shell-popover"
			data-testid="floating-shell-popover"
			data-dragged={dragged ? "true" : "false"}
			role="dialog"
			aria-label={`Throwaway shell ${process.label}`}
			style={{
				...(dragged
					? { position: "fixed", left: pos.left, top: pos.top, right: "auto" }
					: {}),
				...(size ? { width: size.width, height: size.height } : {}),
			}}
		>
			<header
				className="floating-shell-popover__header"
				onPointerDown={onHeaderPointerDown}
				onPointerMove={onHeaderPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onDoubleClick={resetPosition}
			>
				<span
					className="floating-shell-popover__dot"
					data-exited={exited ? "true" : "false"}
					aria-hidden="true"
				/>
				<span className="floating-shell-popover__title">{process.label}</span>
				<button
					type="button"
					aria-label="Pin into layout"
					title={
						pinDisabled ? "Layout full — free a slot first" : "Pin into layout"
					}
					data-testid="floating-shell-pin"
					disabled={pinDisabled || exited}
					onClick={() => onPin(process.id)}
				>
					<Icon name="pin" />
				</button>
				<button
					type="button"
					aria-label="Minimize floating shell"
					title="Minimize"
					data-testid="floating-shell-minimize"
					onClick={() => onMinimize(process.id)}
				>
					<Icon name="minimize" />
				</button>
				<button
					type="button"
					aria-label="Kill floating shell"
					title="Kill"
					data-testid="floating-shell-close"
					onClick={() => onClose(process.id)}
				>
					<Icon name="close" />
				</button>
			</header>
			<div className="floating-shell-popover__body">
				{session && (
					<TerminalPane
						session={session}
						visible={true}
						focused
						theme={theme}
						onTitleChange={onTitleChange}
					/>
				)}
			</div>
			{(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeHandle[]).map(
				(h) => (
					<div
						key={h}
						className={`floating-shell-popover__resize floating-shell-popover__resize--${h}`}
						data-testid={`floating-shell-resize-${h}`}
						onPointerDown={onResizePointerDown(h)}
						onPointerMove={onResizePointerMove}
						onPointerUp={endResize}
						onPointerCancel={endResize}
					/>
				),
			)}
		</div>
	);
}
