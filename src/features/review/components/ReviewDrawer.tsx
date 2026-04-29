type Props = {
	open: boolean;
	isDirty: boolean;
	changedFileCount: number;
	panelHeight: number;
	onToggle: () => void;
	onRefresh: () => void;
	onResizeStart: (e: React.MouseEvent) => void;
	expanded?: boolean;
	onExpand?: () => void;
	onCollapse?: () => void;
	commentSidebarOpen?: boolean;
	onToggleCommentSidebar?: () => void;
	openCommentCount?: number | null;
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
	expanded,
	onExpand,
	onCollapse,
	commentSidebarOpen,
	onToggleCommentSidebar,
	openCommentCount,
	children,
}: Props) {
	const toggleLabel = open ? "Collapse review drawer" : "Expand review drawer";
	const expandLabel = expanded
		? "Collapse full review"
		: "Expand to full review";
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

			<div className="shell-review-drawer__header">
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
					<button
						type="button"
						className="shell-button shell-button--compact shell-button--icon shell-button--round"
						aria-label={expandLabel}
						title={expandLabel}
						data-active={expanded ? "true" : "false"}
						onClick={expanded ? onCollapse : onExpand}
					>
						<span aria-hidden="true">{expanded ? "⬇" : "⬆"}</span>
					</button>
					{onToggleCommentSidebar &&
						openCommentCount !== null &&
						openCommentCount !== undefined && (
							<button
								type="button"
								className="shell-review-comments-toggle"
								aria-label={
									commentSidebarOpen ? "Hide comments" : "Show comments"
								}
								title={commentSidebarOpen ? "Hide comments" : "Show comments"}
								data-active={commentSidebarOpen ? "true" : "false"}
								onClick={onToggleCommentSidebar}
							>
								<svg
									width="13"
									height="13"
									viewBox="0 0 16 16"
									fill="none"
									aria-hidden="true"
								>
									<path
										d="M2 2h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5l-3 2V3a1 1 0 0 1 1-1z"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinejoin="round"
									/>
								</svg>
							</button>
						)}
				</div>
			</div>

			{open &&
				(expanded ? (
					<div className="shell-review-drawer__body--placeholder" />
				) : (
					<div className="shell-review-drawer__body">{children}</div>
				))}
		</section>
	);
}
