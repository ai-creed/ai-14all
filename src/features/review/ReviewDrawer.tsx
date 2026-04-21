type Props = {
	open: boolean;
	isDirty: boolean;
	changedFileCount: number;
	panelHeight: number;
	onToggle: () => void;
	onRefresh: () => void;
	onResizeStart: (e: React.MouseEvent) => void;
	children?: React.ReactNode;
};

export function ReviewDrawer({
	open,
	isDirty,
	changedFileCount,
	panelHeight,
	onToggle,
	onRefresh,
	onResizeStart,
	children,
}: Props) {
	const toggleLabel = open ? "Collapse review drawer" : "Expand review drawer";
	return (
		<section
			className="shell-review-drawer"
			role="region"
			aria-label="Review"
			data-testid="review-drawer"
			data-open={open ? "true" : "false"}
			style={{
				gridTemplateRows: open ? `auto auto ${panelHeight}px` : "auto",
			}}
		>
			{open && (
				<div
					role="separator"
					aria-orientation="horizontal"
					aria-label="Resize review drawer"
					data-testid="review-drawer-resize-handle"
					className="shell-review-drawer__resize-handle"
					onMouseDown={onResizeStart}
				/>
			)}

			<div className="shell-review-drawer__header shell-panel">
				<button
					type="button"
					className="shell-review-drawer__toggle shell-button shell-button--compact shell-button--icon shell-button--round"
					aria-label={toggleLabel}
					aria-expanded={open}
					title={toggleLabel}
					onClick={onToggle}
				>
					<span aria-hidden="true">{open ? "▾" : "▸"}</span>
				</button>
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
				</div>
			</div>

			{open && <div className="shell-review-drawer__body">{children}</div>}
		</section>
	);
}
