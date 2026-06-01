import * as React from "react";
import { PanelLeftOpen, PanelLeftClose } from "lucide-react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Worktree } from "../../../../shared/models/worktree";
import type { ProcessAttentionState } from "../../../../shared/models/process-session";
import type { WorktreeProcessSummary } from "../logic/sidebar-shell-summary";
import { displayTitle } from "../logic/session-display-title";

export type SessionSidebarWorkspace = {
	workspaceId: string;
	name: string;
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	attentionByWorktreeId: Record<string, ProcessAttentionState>;
	processesByWorktreeId?: Record<string, WorktreeProcessSummary>;
	attentionContextByWorktreeId?: Record<string, string>;
	taskByWorktreeId?: Record<string, string | null>;
	titleByWorktreeId?: Record<string, string>;
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
	pendingRename?: { workspaceId: string; worktreeId: string } | null;
};

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
	onRenameSession,
	onRequestExpand,
	onClearFailedReason,
	pendingRename,
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
			className={`grid grid-rows-[auto_minmax(0,1fr)_auto] w-full h-full min-h-0 min-w-0 bg-transparent border border-[var(--pane-border-sessions)] rounded-sm ${collapsed ? "px-2 py-3" : "p-3"}`}
			data-collapsed={String(collapsed)}
		>
			<div className={`flex items-center gap-2 pb-2 border-b border-border ${collapsed ? "justify-center" : "justify-between"}`}>
				{!collapsed && <div className="text-base leading-tight tracking-[0.08em] uppercase text-muted-foreground">Sessions</div>}
				<button
					type="button"
					className="w-8 h-8 p-0 grid place-items-center text-base leading-8 text-foreground bg-card border border-border rounded-full cursor-pointer hover:border-muted-foreground focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-1"
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					onClick={onToggleCollapsed}
				>
					{collapsed ? (
						<PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
					) : (
						<PanelLeftClose className="h-4 w-4" aria-hidden="true" />
					)}
				</button>
			</div>

			<div className={`flex flex-col min-h-0 overflow-y-auto mt-3 gap-0 pr-1 ${collapsed ? "items-center" : ""}`}>
				{workspaces.map((workspace) => (
					<section
						key={workspace.workspaceId}
						role="group"
						aria-label={workspace.name}
						className={`flex flex-col gap-2 py-3 pb-1 [&+&]:before:content-[''] [&+&]:before:block [&+&]:before:h-px [&+&]:before:mx-2 [&+&]:before:mb-3 [&+&]:before:bg-gradient-to-r [&+&]:before:from-transparent [&+&]:before:via-border [&+&]:before:to-transparent ${collapsed ? "items-center p-0" : ""}`}
						data-active-workspace={String(workspace.active)}
					>
						<div className={`flex items-center gap-2 ${collapsed ? "justify-center" : "justify-between"}`}>
							{collapsed ? (
								<button
									type="button"
									className="inline-grid place-items-center w-6 h-6 p-0 text-base font-bold text-secondary-foreground bg-foreground/[0.06] border-none rounded-full cursor-pointer data-[selected=true]:text-foreground data-[selected=true]:bg-accent hover:bg-foreground/10 hover:text-foreground"
									title={workspace.name}
									aria-label={workspace.name}
									data-selected={String(workspace.active)}
									onClick={() => onOpenWorkspace(workspace.workspaceId)}
								>
									{workspace.name.slice(0, 1).toUpperCase()}
								</button>
							) : (
								<>
									<button
										type="button"
										className="min-w-0 p-0 text-base tracking-[0.04em] uppercase text-secondary-foreground bg-transparent border-none cursor-pointer data-[selected=true]:text-foreground"
										data-selected={String(workspace.active)}
										onClick={() => onOpenWorkspace(workspace.workspaceId)}
									>
										{workspace.name}
									</button>
									<button
										type="button"
										className="w-8 h-8 p-0 grid place-items-center text-base leading-8 text-foreground bg-card border border-border rounded-full cursor-pointer hover:border-muted-foreground focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-1"
										aria-label={`Remove ${workspace.name}`}
										onClick={() => onRemoveWorkspace(workspace.workspaceId)}
									>
										&times;
									</button>
								</>
							)}
						</div>

						<div className="flex flex-col gap-2">
							{workspace.worktrees.map((worktree) => {
								const selected =
									workspace.active &&
									worktree.id === workspace.selectedWorktreeId;
								const summary = workspace.processesByWorktreeId?.[worktree.id];
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

								const itemClassName = collapsed
									? "w-10 h-10 min-h-0 p-0 justify-center flex flex-col items-start text-left text-foreground bg-transparent border-none cursor-pointer leading-[1.3]"
									: "w-full flex flex-col items-start gap-1 px-3 py-2 text-left text-foreground bg-transparent border-none cursor-pointer leading-[1.3]";

								const rowCommonProps = {
									className: itemClassName,
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
										className="appearance-none w-full m-0 px-2 py-1 text-foreground bg-card border border-[var(--panel-border-strong)] rounded-sm font-[inherit] leading-[1.3] hover:not(:focus):border-muted-foreground focus-visible:outline-none focus-visible:border-ring"
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
									<span className="inline-grid place-items-center w-full h-full font-semibold">
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
											<div className="text-secondary-foreground text-xs">
												{worktree.label}
											</div>
										)}
										{worktree.branchName !== worktree.label && (
											<div className="text-secondary-foreground">
												{worktree.branchName}
											</div>
										)}
									</>
								);

								const task = workspace.taskByWorktreeId?.[worktree.id];
								const taskLine =
									!isRenamingThisRow && !collapsed && task ? (
										<div className="block text-muted-foreground text-xs my-1 whitespace-nowrap overflow-hidden text-ellipsis px-3 before:content-['\21AA\0020'] before:mr-1" title={task}>
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
										<div className="flex flex-col gap-2 px-3 pb-3">
											{sessionAttentionContext ? (
												<div className="flex items-center gap-1 text-xs min-w-0">
													<span
														className="text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
														title={sessionAttentionContext}
													>
														{sessionAttentionContext}
													</span>
												</div>
											) : null}
											{summary?.rows.map((row) => (
												<div key={row.id} className="flex items-center gap-1 text-xs min-w-0">
													<span
														data-testid="process-state-indicator"
														className="shell-sidebar__process-indicator inline-block w-1.5 h-1.5 rounded-full shrink-0"
														data-state={row.state}
													/>
													{row.provider && (
														<span
															className="inline-flex items-center px-2 py-px rounded-sm text-xs font-semibold tracking-[0.3px] lowercase mr-2 data-[provider=claude]:bg-[color-mix(in_srgb,var(--provider-claude)_14%,transparent)] data-[provider=claude]:text-[var(--provider-claude)] data-[provider=codex]:bg-[color-mix(in_srgb,var(--provider-codex)_14%,transparent)] data-[provider=codex]:text-[var(--provider-codex)] data-[provider=other]:bg-[color-mix(in_srgb,var(--muted-foreground)_14%,transparent)] data-[provider=other]:text-muted-foreground"
															data-provider={row.provider}
														>
															{row.provider}
														</span>
													)}
													<span
														className="text-foreground min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
														title={row.label}
													>
														{row.label}
													</span>
													{row.context ? (
														<span
															className="text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
															title={row.context}
														>
															{row.context}
														</span>
													) : null}
													{row.hasFailedReason &&
													onClearFailedReason &&
													workspace.active ? (
														<button
															type="button"
															className="h-6 px-2 text-xs leading-6 text-foreground bg-card border border-border rounded-sm cursor-pointer hover:border-muted-foreground focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-1"
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
														</button>
													) : null}
												</div>
											))}
											{summary && summary.overflowCount > 0 && (
												<div className="flex items-center gap-1 text-xs min-w-0 text-muted-foreground">
													{summary.overflowCount} more shell
													{summary.overflowCount === 1 ? "" : "s"}
												</div>
											)}
										</div>
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
													onRequestExpand?.(workspace.workspaceId, worktree.id);
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
										<div
											key={worktree.id}
											className="shell-sidebar__row bg-card border border-border rounded-sm overflow-hidden cursor-pointer transition-colors hover:bg-accent data-[selected=true]:bg-secondary data-[selected=true]:border-ring"
											{...rowAttentionProps}
											onClick={handleRowClick}
										>
											{item}
											{taskLine}
											{processList}
										</div>
									);
								}

								return (
									<ContextMenu key={worktree.id}>
										<div
											className="shell-sidebar__row bg-card border border-border rounded-sm overflow-hidden cursor-pointer transition-colors hover:bg-accent data-[selected=true]:bg-secondary data-[selected=true]:border-ring"
											{...rowAttentionProps}
											onClick={handleRowClick}
										>
											<ContextMenuTrigger asChild>{item}</ContextMenuTrigger>
											{taskLine}
											{processList}
										</div>
										<ContextMenuContent className="min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
											<ContextMenuItem
												className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
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
													className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none text-destructive focus:bg-accent focus:text-destructive"
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
								);
							})}

							{workspace.worktrees.length === 0 && !collapsed && (
								<div className="px-1 pb-1 text-muted-foreground text-xs italic leading-[1.4]">
									{workspace.hydrated
										? "No worktree sessions yet."
										: "Open this workspace to load its worktree sessions."}
								</div>
							)}
						</div>

						{workspace.active && (
							<div className="mt-auto pt-3">
								<button
									type="button"
									className="h-8 px-3 text-sm leading-8 text-foreground bg-card border border-border rounded-sm cursor-pointer hover:border-muted-foreground focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-1"
									onClick={() => onCreateWorktree(workspace.workspaceId)}
									aria-label="New session"
								>
									{collapsed ? "+" : "+ New session"}
								</button>
							</div>
						)}
					</section>
				))}
			</div>
			<div className="mt-3">
				<button
					type="button"
					className="h-8 px-3 text-sm leading-8 text-foreground bg-card border border-border rounded-sm cursor-pointer hover:border-muted-foreground focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-1"
					onClick={onLoadWorkspace}
					aria-label="Load workspace"
				>
					{collapsed ? "Load" : "Load workspace"}
				</button>
			</div>
		</nav>
	);
}
