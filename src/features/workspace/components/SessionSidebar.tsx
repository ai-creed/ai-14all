import * as React from "react";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Worktree } from "../../../../shared/models/worktree";
import type {
	SidebarAttentionTier,
	WorktreeProcessSummary,
} from "../logic/sidebar-shell-summary";
import { displayTitle } from "../logic/session-display-title";
import type { WorkflowRow as WorkflowRowModel } from "../../workflows/logic/workflow-lens";
import { WorkflowRow } from "../../workflows/components/WorkflowRow";
import { Icon } from "@/components/ui/icon";
import type { Palette } from "../../../lib/use-theme";

export type SessionSidebarWorkspace = {
	workspaceId: string;
	name: string;
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	attentionByWorktreeId: Record<string, SidebarAttentionTier>;
	processesByWorktreeId?: Record<string, WorktreeProcessSummary>;
	attentionContextByWorktreeId?: Record<string, string>;
	taskByWorktreeId?: Record<string, string | null>;
	titleByWorktreeId?: Record<string, string>;
	// Pre-derived workflow lens rows keyed by worktreeId. Present ONLY for
	// worktrees that have whisper state — the row never renders otherwise, so the
	// sidebar stays unchanged in the no-plugin world.
	workflowRowByWorktreeId?: Record<
		string,
		WorkflowRowModel & { stale?: boolean }
	>;
	collapsedSummary: {
		sessionCount: number;
		attentionTier: "actionRequired" | "ready" | null;
	};
	active: boolean;
	hydrated: boolean;
};

type Props = {
	workspaces: SessionSidebarWorkspace[];
	collapsed: boolean;
	onToggleCollapsed: () => void;
	onLoadWorkspace: () => void;
	onOpenWorkspace: (workspaceId: string) => void;
	onSelect: (workspaceId: string, worktreeId: string) => void;
	onCreateWorktree: (workspaceId: string) => void;
	onRemoveWorktree: (workspaceId: string, worktreeId: string) => void;
	onRemoveWorkspace: (workspaceId: string) => void;
	collapsedWorkspaceIds?: string[];
	onToggleWorkspaceCollapsed?: (workspaceId: string) => void;
	onRenameSession?: (
		workspaceId: string,
		worktreeId: string,
		title: string,
	) => void;
	onRequestExpand?: (workspaceId: string, worktreeId: string) => void;
	onClearFailedReason?: (
		workspaceId: string,
		worktreeId: string,
		processId: string,
	) => void;
	onOpenWorkflowDetail?: (workspaceId: string, worktreeId: string) => void;
	pendingRename?: { workspaceId: string; worktreeId: string } | null;
	palette?: Palette;
	onSetTheme?: (mode: Palette) => void;
	onOpenShortcutsHelp?: () => void;
	expandedProcessWorktreeIds?: string[];
	onToggleProcessExpanded?: (worktreeId: string) => void;
};

const THEMES: { mode: Palette; label: string }[] = [
	{ mode: "dark", label: "Dark" },
	{ mode: "light", label: "Light" },
	{ mode: "warm", label: "Warm" },
	{ mode: "tui", label: "TUI" },
];

export function SessionSidebar({
	workspaces,
	collapsed,
	onToggleCollapsed,
	onLoadWorkspace,
	onOpenWorkspace,
	onSelect,
	onCreateWorktree,
	onRemoveWorktree,
	onRemoveWorkspace,
	collapsedWorkspaceIds,
	onToggleWorkspaceCollapsed,
	onRenameSession,
	onRequestExpand,
	onClearFailedReason,
	onOpenWorkflowDetail,
	pendingRename,
	palette,
	onSetTheme,
	onOpenShortcutsHelp,
	expandedProcessWorktreeIds,
	onToggleProcessExpanded,
}: Props) {
	const [renaming, setRenaming] = React.useState<{
		workspaceId: string;
		worktreeId: string;
	} | null>(null);
	const [draft, setDraft] = React.useState("");
	const seededKeyRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		if (collapsed || !pendingRename) {
			seededKeyRef.current = null;
			return;
		}
		const key = `${pendingRename.workspaceId}:${pendingRename.worktreeId}`;
		// Seed only once per pendingRename request. Without this, any unrelated
		// `workspaces` update during editing (status polling, attention reasons,
		// etc.) would re-run this effect and clobber the user's typed draft.
		if (seededKeyRef.current === key) return;
		const target = workspaces.find(
			(w) => w.workspaceId === pendingRename.workspaceId,
		);
		if (!target || !target.active) return;
		setDraft(target.titleByWorktreeId?.[pendingRename.worktreeId] ?? "");
		setRenaming(pendingRename);
		seededKeyRef.current = key;
	}, [collapsed, pendingRename, workspaces]);

	function startRename(
		workspaceId: string,
		worktreeId: string,
		currentTitle: string,
	) {
		setDraft(currentTitle);
		setRenaming({ workspaceId, worktreeId });
	}

	function commitRename(workspaceId: string, worktreeId: string) {
		onRenameSession?.(workspaceId, worktreeId, draft.trim());
		setRenaming(null);
	}

	function cancelRename() {
		setRenaming(null);
	}

	return (
		<nav
			aria-label="Worktree sessions"
			className="shell-panel shell-sidebar"
			data-collapsed={String(collapsed)}
		>
			<div className="shell-sidebar__header">
				{!collapsed && <div className="shell-label">Workspace</div>}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					onClick={onToggleCollapsed}
				>
					<span aria-hidden="true">
						{collapsed ? (
							<Icon name="sidebar-collapse" />
						) : (
							<Icon name="sidebar-expand" />
						)}
					</span>
				</Button>
			</div>

			<div className="shell-sidebar__list">
				{workspaces.map((workspace) => {
					const repoCollapsed =
						!collapsed &&
						(collapsedWorkspaceIds?.includes(workspace.workspaceId) ?? false);
					return (
						<section
							key={workspace.workspaceId}
							role="group"
							aria-label={workspace.name}
							className="shell-sidebar__workspace-group"
							data-active-workspace={String(workspace.active)}
						>
							<div className="shell-sidebar__workspace-header">
								{collapsed ? (
									<button
										type="button"
										className="shell-sidebar__workspace-badge"
										title={workspace.name}
										aria-label={workspace.name}
										data-selected={String(workspace.active)}
										onClick={() => onOpenWorkspace(workspace.workspaceId)}
									>
										<span aria-hidden="true">
											<Icon name="git-branch" />
										</span>
										<span className="shell-sidebar__workspace-badge-initial">
											{workspace.name.slice(0, 1).toUpperCase()}
										</span>
										{workspace.collapsedSummary.sessionCount > 0 && (
											<span className="shell-sidebar__workspace-count">
												{workspace.collapsedSummary.sessionCount}
											</span>
										)}
										{workspace.collapsedSummary.attentionTier && (
											<span
												data-testid="workspace-rollup-dot"
												className="shell-sidebar__workspace-rollup-dot"
												data-tier={workspace.collapsedSummary.attentionTier}
												aria-hidden="true"
											/>
										)}
									</button>
								) : (
									<>
										<button
											type="button"
											className="shell-sidebar__workspace-toggle"
											aria-label={`${repoCollapsed ? "Expand" : "Collapse"} ${workspace.name}`}
											aria-expanded={!repoCollapsed}
											onClick={() =>
												onToggleWorkspaceCollapsed?.(workspace.workspaceId)
											}
										>
											<span
												className="shell-sidebar__chevron"
												aria-hidden="true"
											>
												<Icon
													name={repoCollapsed ? "caret-right" : "caret-down"}
												/>
											</span>
											<span
												className="shell-sidebar__workspace-icon"
												aria-hidden="true"
											>
												<Icon name="git-branch" />
											</span>
										</button>
										<button
											type="button"
											className="shell-sidebar__workspace-name"
											data-selected={String(workspace.active)}
											onClick={() => onOpenWorkspace(workspace.workspaceId)}
										>
											{workspace.name}
										</button>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="shell-sidebar__workspace-remove"
											aria-label={`Remove ${workspace.name}`}
											onClick={() => onRemoveWorkspace(workspace.workspaceId)}
										>
											<Icon name="close" fallback="×" />
										</Button>
									</>
								)}
							</div>

							{!repoCollapsed && (
								<div className="shell-sidebar__workspace-items">
									{workspace.worktrees.map((worktree) => {
										const selected =
											workspace.active &&
											worktree.id === workspace.selectedWorktreeId;
										const summary =
											workspace.processesByWorktreeId?.[worktree.id];
										const rawTitle =
											workspace.titleByWorktreeId?.[worktree.id] ?? "";
										const shownTitle = displayTitle(rawTitle, worktree);
										const hasCustomTitle = rawTitle.trim().length > 0;
										const isRenamingThisRow =
											renaming?.workspaceId === workspace.workspaceId &&
											renaming?.worktreeId === worktree.id;

										// Mirrored on the wrapper so CSS can frame the title button + process
										// list as a single card; tests still read the attributes off the button.
										const rowAttentionProps = {
											"data-selected": String(selected),
											"data-attention":
												workspace.attentionByWorktreeId[worktree.id] ?? "idle",
										};

										const rowCommonProps = {
											className: "shell-sidebar__item",
											...rowAttentionProps,
											"aria-label":
												worktree.branchName !== shownTitle
													? `${shownTitle} ${worktree.branchName}`
													: shownTitle,
										};

										const rowContents = isRenamingThisRow ? (
											<input
												autoFocus
												aria-label="Rename session"
												className="shell-sidebar__rename-input"
												value={draft}
												onChange={(e) => setDraft(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter") {
														e.preventDefault();
														commitRename(workspace.workspaceId, worktree.id);
													} else if (e.key === "Escape") {
														e.preventDefault();
														cancelRename();
													}
												}}
												onBlur={() =>
													commitRename(workspace.workspaceId, worktree.id)
												}
											/>
										) : collapsed ? (
											<span className="shell-sidebar__marker">
												{shownTitle.slice(0, 1).toUpperCase()}
											</span>
										) : (
											<>
												<strong
													onDoubleClick={(e) => {
														if (!workspace.active) return;
														e.stopPropagation();
														startRename(
															workspace.workspaceId,
															worktree.id,
															rawTitle,
														);
													}}
												>
													{shownTitle}
												</strong>
												{hasCustomTitle && (
													<div className="shell-sidebar__worktree-label">
														{worktree.label}
													</div>
												)}
												{worktree.branchName !== worktree.label && (
													<div className="shell-sidebar__branch">
														{worktree.branchName}
													</div>
												)}
											</>
										);

										const task = workspace.taskByWorktreeId?.[worktree.id];
										const taskLine =
											!isRenamingThisRow && !collapsed && task ? (
												<div className="shell-sidebar__card-task" title={task}>
													{task}
												</div>
											) : null;

										// Process list rendered outside the row button to avoid nested <button> elements.
										const sessionAttentionContext =
											workspace.attentionContextByWorktreeId?.[worktree.id];
										const processList =
											!isRenamingThisRow &&
											!collapsed &&
											(summary || sessionAttentionContext) ? (
												<div className="shell-sidebar__processes">
													{sessionAttentionContext ? (
														<div className="shell-sidebar__process shell-sidebar__process--session">
															<span
																className="shell-sidebar__process-context"
																title={sessionAttentionContext}
															>
																{sessionAttentionContext}
															</span>
														</div>
													) : null}
													{(() => {
														const expanded =
															expandedProcessWorktreeIds?.includes(worktree.id) ??
															false;
														const allRows = summary?.rows ?? [];
														const top =
															summary?.topRow ?? allRows[0] ?? null;
														const visibleRows =
															expanded || allRows.length <= 1
																? allRows
																: top
																	? [top]
																	: allRows.slice(0, 1);
														const hiddenCount =
															(summary?.overflowCount ?? 0) +
															Math.max(0, allRows.length - visibleRows.length);
														return (
															<>
																{visibleRows.map((row) => (
																	<div
																		key={row.id}
																		className="shell-sidebar__process"
																	>
																		<span
																			data-testid="process-state-indicator"
																			className="shell-sidebar__process-indicator"
																			data-state={row.state}
																		/>
																		{row.provider && (
																			<span
																				className="shell-sidebar__provider-badge"
																				data-provider={row.provider}
																			>
																				{row.provider}
																			</span>
																		)}
																		<span
																			className="shell-sidebar__process-label"
																			title={row.label}
																		>
																			{row.label}
																		</span>
																		{row.context ? (
																			<span
																				className="shell-sidebar__process-context"
																				title={row.context}
																			>
																				{row.context}
																			</span>
																		) : null}
																		{row.hasFailedReason &&
																		onClearFailedReason &&
																		workspace.active ? (
																			<Button
																				type="button"
																				variant="secondary"
																				size="sm"
																				className="shell-sidebar__process-clear-failed"
																				aria-label={`Clear failed for ${row.label}`}
																				onClick={(e) => {
																					e.stopPropagation();
																					onClearFailedReason(
																						workspace.workspaceId,
																						worktree.id,
																						row.id,
																					);
																				}}
																			>
																				Clear failed
																			</Button>
																		) : null}
																	</div>
																))}
																{!expanded && hiddenCount > 0 && (
																	<button
																		type="button"
																		className="shell-sidebar__process shell-sidebar__process--more"
																		onClick={(e) => {
																			e.stopPropagation();
																			onToggleProcessExpanded?.(worktree.id);
																		}}
																	>
																		{hiddenCount} more ›
																	</button>
																)}
																{expanded && allRows.length > 1 && (
																	<button
																		type="button"
																		className="shell-sidebar__process shell-sidebar__process--more"
																		onClick={(e) => {
																			e.stopPropagation();
																			onToggleProcessExpanded?.(worktree.id);
																		}}
																	>
																		Show less ‹
																	</button>
																)}
															</>
														);
													})()}
												</div>
											) : null;

										// Workflow lens row: only present when whisper state exists for
										// this worktree, and never while renaming or collapsed.
										const workflowRowModel =
											workspace.workflowRowByWorktreeId?.[worktree.id];
										const workflowRow =
											!isRenamingThisRow && !collapsed && workflowRowModel ? (
												<WorkflowRow
													row={workflowRowModel}
													onOpenDetail={() =>
														onOpenWorkflowDetail?.(
															workspace.workspaceId,
															worktree.id,
														)
													}
												/>
											) : null;

										const item = isRenamingThisRow ? (
											<div role="presentation" {...rowCommonProps}>
												{rowContents}
											</div>
										) : (
											<button
												type="button"
												{...rowCommonProps}
												onKeyDown={(e) => {
													if (e.key === "F2") {
														e.preventDefault();
														if (collapsed || !workspace.active) {
															onRequestExpand?.(
																workspace.workspaceId,
																worktree.id,
															);
															return;
														}
														startRename(
															workspace.workspaceId,
															worktree.id,
															rawTitle,
														);
													}
												}}
											>
												{rowContents}
											</button>
										);

										// onClick on the wrapper makes the entire card (title + process list)
										// the click target. Keyboard activation still flows through the inner
										// <button>: pressing Enter/Space fires its native click which bubbles
										// up to this handler. Inline-clickable children (Clear failed) stop
										// propagation to keep their action separate from row selection.
										const handleRowClick = isRenamingThisRow
											? undefined
											: () => onSelect(workspace.workspaceId, worktree.id);

										if (collapsed || !workspace.active) {
											return (
												<div className="shell-sidebar__node" key={worktree.id}>
													<div
														className="shell-sidebar__row"
														{...rowAttentionProps}
														onClick={handleRowClick}
													>
														{item}
														{taskLine}
														{processList}
														{workflowRow}
													</div>
												</div>
											);
										}

										return (
											<div className="shell-sidebar__node" key={worktree.id}>
												<ContextMenu>
													<div
														className="shell-sidebar__row"
														{...rowAttentionProps}
														onClick={handleRowClick}
													>
														<ContextMenuTrigger asChild>
															{item}
														</ContextMenuTrigger>
														{taskLine}
														{processList}
														{workflowRow}
													</div>
													<ContextMenuContent className="shell-toolbar-menu">
														<ContextMenuItem
															className="shell-toolbar-menu__item"
															onSelect={() => {
																if (collapsed || !workspace.active) {
																	onRequestExpand?.(
																		workspace.workspaceId,
																		worktree.id,
																	);
																	return;
																}
																startRename(
																	workspace.workspaceId,
																	worktree.id,
																	rawTitle,
																);
															}}
														>
															Rename session
														</ContextMenuItem>
														{!worktree.isMain && (
															<ContextMenuItem
																className="shell-toolbar-menu__item shell-toolbar-menu__item--danger"
																onSelect={() =>
																	onRemoveWorktree(
																		workspace.workspaceId,
																		worktree.id,
																	)
																}
															>
																Remove worktree
															</ContextMenuItem>
														)}
													</ContextMenuContent>
												</ContextMenu>
											</div>
										);
									})}

									{workspace.worktrees.length === 0 && !collapsed && (
										<div className="shell-sidebar__workspace-empty">
											{workspace.hydrated
												? "No worktree sessions yet."
												: "Open this workspace to load its worktree sessions."}
										</div>
									)}
									{workspace.active && (
										<div className="shell-sidebar__node shell-sidebar__node--new">
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="w-full shadow-none"
												onClick={() => onCreateWorktree(workspace.workspaceId)}
												aria-label="New session"
											>
												{collapsed ? "+" : "+ New session"}
											</Button>
										</div>
									)}
								</div>
							)}
						</section>
					);
				})}
			</div>
			<div className="shell-sidebar__footer shell-sidebar__footer--global">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="w-full shadow-none"
					onClick={onLoadWorkspace}
					aria-label="Load workspace"
				>
					{collapsed ? "Load" : "Load workspace"}
				</Button>
				{onSetTheme && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="shell-sidebar__theme-trigger"
								aria-label="Switch theme"
							>
								<Icon name="palette" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="shell-toolbar-menu">
							{THEMES.map((t) => (
								<DropdownMenuItem
									key={t.mode}
									className="shell-toolbar-menu__item"
									data-active={String(palette === t.mode)}
									onSelect={() => onSetTheme(t.mode)}
								>
									{t.label}
									{palette === t.mode && (
										<Icon name="check" className="ml-auto" />
									)}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				{onOpenShortcutsHelp && (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="shell-sidebar__help-trigger"
						aria-label="Keyboard shortcuts"
						title="Keyboard shortcuts"
						onClick={onOpenShortcutsHelp}
					>
						<Icon name="help" />
					</Button>
				)}
			</div>
		</nav>
	);
}
