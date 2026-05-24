import * as Dialog from "@radix-ui/react-dialog";
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
		<Dialog.Root
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-layout-dialog__overlay" />
				<Dialog.Content
					className="shell-layout-dialog"
					data-testid="terminal-layout-dialog"
				>
					<Dialog.Title className="shell-layout-dialog__title">
						Choose terminal layout
					</Dialog.Title>
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
												type="button"
												data-testid={`layout-tile-${id}`}
												className="shell-layout-dialog__tile"
												aria-pressed={id === currentLayoutId}
												data-current={id === currentLayoutId ? "true" : "false"}
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
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
