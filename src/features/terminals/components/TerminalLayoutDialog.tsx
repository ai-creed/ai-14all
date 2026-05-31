import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	TERMINAL_LAYOUTS,
	LAYOUT_IDS,
	type LayoutId,
} from "../logic/terminal-layouts";

interface Props {
	open: boolean;
	runningShells: number;
	currentLayoutId: LayoutId;
	onSelect: (id: LayoutId) => void;
	onClose: () => void;
}

const BUCKETS = [1, 2, 3, 4, 5, 6] as const;

export function TerminalLayoutDialog({
	open,
	runningShells,
	currentLayoutId,
	onSelect,
	onClose,
}: Props): React.ReactElement {
	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<DialogContent
				className="w-[560px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)] overflow-y-auto p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
				data-testid="terminal-layout-dialog"
			>
				<DialogTitle className="text-[13px] font-semibold mb-3 text-foreground">
					Choose terminal layout
				</DialogTitle>
				{BUCKETS.map((count) => {
					const ids = LAYOUT_IDS.filter(
						(id) => TERMINAL_LAYOUTS[id].slotCount === count,
					);
					return (
						<section
							key={count}
							className="flex gap-3 items-start py-2 border-t border-border"
						>
							<div className="flex-[0_0_72px] text-[11px] text-muted-foreground pt-1.5">
								{count} shell{count > 1 ? "s" : ""}
							</div>
							<div className="flex flex-wrap gap-2.5">
								{ids.map((id) => {
									const d = TERMINAL_LAYOUTS[id];
									const disabled = d.slotCount < runningShells;
									return (
										<button
											key={id}
											type="button"
											data-testid={`layout-tile-${id}`}
											className="w-[132px] h-[78px] p-1.5 border border-border rounded-sm bg-muted cursor-pointer hover:enabled:border-accent-foreground aria-pressed:border-accent-foreground aria-pressed:shadow-[0_0_0_1px_hsl(var(--ring))] disabled:opacity-35 disabled:cursor-not-allowed"
											aria-pressed={id === currentLayoutId}
											data-current={id === currentLayoutId ? "true" : "false"}
											disabled={disabled}
											title={id}
											onClick={() => onSelect(id)}
										>
											<span
												className="grid gap-[3px] w-full h-full"
												style={{
													gridTemplateColumns: d.gridTemplateColumns,
													gridTemplateRows: d.gridTemplateRows,
												}}
											>
												{d.slotPlacements.map((p, i) => (
													<span
														key={i}
														className={`rounded-[2px] ${i < d.masterSlots ? "bg-[#3a4f7d]" : "bg-[#222a3a]"}`}
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
			</DialogContent>
		</Dialog>
	);
}
