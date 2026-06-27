import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
	TERMINAL_LAYOUTS,
	LAYOUT_IDS,
	type LayoutId,
} from "../logic/terminal-layouts";
import {
	nextLayoutTile,
	type NavDirection,
	type NavTile,
} from "../logic/layout-grid-nav";

interface Props {
	open: boolean;
	runningShells: number;
	currentLayoutId: LayoutId;
	onSelect: (id: LayoutId) => void;
	onClose: () => void;
}

const BUCKETS = [1, 2, 3, 4, 5, 6] as const;

const ARROW_DIRECTIONS: Record<string, NavDirection> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};

export function TerminalLayoutDialog({
	open,
	runningShells,
	currentLayoutId,
	onSelect,
	onClose,
}: Props): React.ReactElement {
	const tileRefs = useRef<Map<LayoutId, HTMLButtonElement>>(new Map());
	const [focusedId, setFocusedId] = useState<LayoutId | null>(null);

	// Seed focus to the current layout each time the dialog opens; clear on close.
	useEffect(() => {
		if (!open) {
			setFocusedId(null);
			return;
		}
		setFocusedId(currentLayoutId);
		// Focus after paint so the tile element exists in the DOM.
		const raf = requestAnimationFrame(() => {
			tileRefs.current.get(currentLayoutId)?.focus();
		});
		return () => cancelAnimationFrame(raf);
	}, [open, currentLayoutId]);

	// Snapshot the rendered tile geometry for the pure navigation helper.
	const readTiles = useCallback((): NavTile[] => {
		const out: NavTile[] = [];
		for (const [id, el] of tileRefs.current) {
			const r = el.getBoundingClientRect();
			out.push({
				id,
				rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
				disabled: el.disabled,
			});
		}
		return out;
	}, []);

	const moveFocus = useCallback(
		(dir: NavDirection) => {
			const from = focusedId ?? currentLayoutId;
			const nextId = nextLayoutTile(readTiles(), from, dir) as LayoutId;
			setFocusedId(nextId);
			const el = tileRefs.current.get(nextId);
			el?.focus();
			el?.scrollIntoView({ block: "nearest" });
		},
		[focusedId, currentLayoutId, readTiles],
	);

	const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const dir = ARROW_DIRECTIONS[e.key];
		if (dir) {
			e.preventDefault();
			moveFocus(dir);
			return;
		}
		if (e.key === "Enter" || e.key === " ") {
			if (focusedId) {
				e.preventDefault();
				onSelect(focusedId);
			}
		}
	};

	const rovingId = focusedId ?? currentLayoutId;

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<DialogContent
				className="shell-layout-dialog"
				data-testid="terminal-layout-dialog"
			>
				<DialogTitle className="shell-layout-dialog__title">
					Choose terminal layout
				</DialogTitle>
				<div className="shell-layout-dialog__grid" onKeyDown={onGridKeyDown}>
					{BUCKETS.map((count) => {
						const ids = LAYOUT_IDS.filter(
							(id) => TERMINAL_LAYOUTS[id].slotCount === count,
						);
						return (
							<section key={count} className="shell-layout-dialog__bucket">
								<div className="shell-layout-dialog__bucket-label">
									{count} shell{count > 1 ? "s" : ""}
								</div>
								<div className="shell-layout-dialog__tiles">
									{ids.map((id) => {
										const d = TERMINAL_LAYOUTS[id];
										const disabled = d.slotCount < runningShells;
										return (
											<button
												key={id}
												ref={(el) => {
													if (el) tileRefs.current.set(id, el);
													else tileRefs.current.delete(id);
												}}
												type="button"
												data-testid={`layout-tile-${id}`}
												className="shell-layout-dialog__tile"
												aria-pressed={id === currentLayoutId}
												data-current={id === currentLayoutId ? "true" : "false"}
												tabIndex={id === rovingId ? 0 : -1}
												disabled={disabled}
												title={id}
												onClick={() => onSelect(id)}
											>
												<span
													className="shell-layout-dialog__glyph"
													style={{
														gridTemplateColumns: d.gridTemplateColumns,
														gridTemplateRows: d.gridTemplateRows,
													}}
												>
													{d.slotPlacements.map((p, i) => (
														<span
															key={i}
															className="shell-layout-dialog__cell"
															data-master={i < d.masterSlots ? "true" : "false"}
															style={{
																gridColumn: p.gridColumn,
																gridRow: p.gridRow,
															}}
														/>
													))}
												</span>
											</button>
										);
									})}
								</div>
							</section>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
}
