import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type {
	GitChange,
	GitChangeStatus,
} from "../../../../shared/models/git-change";
import { files } from "../../../lib/desktop-client";
import { ToggleSwitch } from "../../../ui/ToggleSwitch";
import {
	buildFileTree,
	type FileTreeEntry,
	WORKTREE_TREE_ROOT_PATH,
} from "../logic/build-file-tree";
import {
	flattenTreeToRows,
	type VisibleRow,
} from "../logic/flatten-tree-to-rows";
import { Icon } from "@/components/ui/icon";

export type WorktreeTreeProps = {
	workspaceId: string;
	worktreeId: string;
	worktreeLabel: string;
	searchTerm: string;
	selectedFile: string | null;
	onSelect: (relativePath: string) => void;
	changedFiles: GitChange[];
	gitSummaryError?: boolean;
	gitSummaryMessage?: string | null;
	expandedPaths: string[];
	onExpandedPathsChange: (worktreeId: string, paths: string[]) => void;
	showIgnored: boolean;
	onToggleShowIgnored: () => void;
};

export function WorktreeTree(props: WorktreeTreeProps) {
	const {
		workspaceId,
		worktreeId,
		worktreeLabel,
		searchTerm,
		selectedFile,
		onSelect,
		changedFiles,
		gitSummaryError,
		gitSummaryMessage,
		expandedPaths,
		onExpandedPathsChange,
		showIgnored,
		onToggleShowIgnored,
	} = props;

	const [fileList, setFileList] = useState<FileTreeEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const requestIdRef = useRef(0);
	const didInitExpandRef = useRef<string | null>(null);
	const scrollParentRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		reload();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [workspaceId, worktreeId, showIgnored]);

	async function reload() {
		const myId = ++requestIdRef.current;
		const capturedWorktreeId = worktreeId;
		setLoading(true);
		setError(null);
		try {
			const entries = await files.listWorktree(workspaceId, worktreeId, {
				includeIgnored: showIgnored,
			});
			if (requestIdRef.current !== myId) return;
			if (capturedWorktreeId !== worktreeId) return;
			setFileList(entries);
			if (
				didInitExpandRef.current !== worktreeId &&
				!expandedPaths.includes(WORKTREE_TREE_ROOT_PATH)
			) {
				didInitExpandRef.current = worktreeId;
				onExpandedPathsChange(worktreeId, [WORKTREE_TREE_ROOT_PATH]);
			} else {
				didInitExpandRef.current = worktreeId;
			}
		} catch (err) {
			if (requestIdRef.current !== myId) return;
			if (capturedWorktreeId !== worktreeId) return;
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			if (requestIdRef.current === myId) setLoading(false);
		}
	}

	const tree = useMemo(() => buildFileTree(fileList), [fileList]);
	const fileCount = fileList.length;
	const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);
	const changedFilesMap = useMemo(() => {
		const m = new Map<string, GitChangeStatus>();
		if (!gitSummaryError) {
			for (const change of changedFiles) m.set(change.path, change.status);
		}
		return m;
	}, [changedFiles, gitSummaryError]);

	const rows = useMemo<VisibleRow[]>(
		() =>
			flattenTreeToRows({
				tree,
				rootLabel: worktreeLabel,
				expandedPaths: expandedSet,
				changedFiles: changedFilesMap,
				searchTerm,
			}),
		[tree, worktreeLabel, expandedSet, changedFilesMap, searchTerm],
	);

	const rowVirtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollParentRef.current,
		estimateSize: () => 28,
		overscan: 10,
	});

	function renderRow(row: VisibleRow) {
		const isDir = row.kind === "dir";
		const isRoot = row.kind === "dir" && row.path === WORKTREE_TREE_ROOT_PATH;
		const handleClick = () => {
			if (isDir) {
				const next = expandedSet.has(row.path)
					? expandedPaths.filter((p) => p !== row.path)
					: [...expandedPaths, row.path];
				onExpandedPathsChange(worktreeId, next);
			} else {
				onSelect(row.path);
			}
		};
		const body = (
			<div
				role="button"
				tabIndex={0}
				className={
					(isDir
						? "shell-list__item shell-list__item--tree shell-list__item--dir"
						: "shell-list__item shell-list__item--tree") +
					(row.ignored ? " shell-list__item--ignored" : "")
				}
				data-selected={!isDir && row.path === selectedFile}
				data-ignored={row.ignored ? "true" : undefined}
				style={{ paddingLeft: `${row.depth * 16}px` }}
				onClick={handleClick}
			>
				{isDir && (
					<span className="shell-tree-chevron" aria-hidden="true">
						{row.expanded ? (
							<Icon name="caret-down" />
						) : (
							<Icon name="caret-right" />
						)}
					</span>
				)}
				<span
					style={{
						lineHeight: 1,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						minWidth: 0,
						flex: 1,
					}}
				>
					{row.name}
				</span>
				{row.kind === "file" && row.gitStatus && (
					<span
						className={`shell-tree-badge shell-tree-badge--${row.gitStatus === "??" ? "untracked" : row.gitStatus.toLowerCase()}`}
						data-git-status={row.gitStatus}
						aria-label={`Git status ${row.gitStatus}`}
					>
						{row.gitStatus}
					</span>
				)}
			</div>
		);
		if (isRoot) {
			return (
				<ContextMenu key={`${row.kind}:${row.path}`}>
					<ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
					<ContextMenuContent className="shell-toolbar-menu">
						<ContextMenuItem
							className="shell-toolbar-menu__item"
							onSelect={() => reload()}
						>
							Refresh
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			);
		}
		return <div key={`${row.kind}:${row.path}`}>{body}</div>;
	}

	return (
		<div className="shell-list" style={{ marginLeft: "8px" }}>
			{gitSummaryError && (
				<p className="shell-inline-warning">
					{gitSummaryMessage ??
						"Git summary unavailable — file badges are hidden."}
				</p>
			)}
			{error && <p className="shell-error">Unable to load files: {error}</p>}
			<div className="shell-tree-header">
				<ToggleSwitch
					id="worktree-tree-show-gitignored"
					checked={showIgnored}
					onChange={onToggleShowIgnored}
					label="Show gitignored"
					ariaLabel="Show gitignored files"
				/>
			</div>
			{loading && fileCount === 0 && (
				<p className="shell-empty-state">Loading files…</p>
			)}
			{fileCount === 0 && !loading && (
				<p className="shell-empty-state">No files in this worktree.</p>
			)}
			<div
				ref={scrollParentRef}
				className="shell-tree-scroll"
				style={{ overflow: "auto" }}
			>
				<div
					style={{
						height: rowVirtualizer.getTotalSize(),
						position: "relative",
					}}
				>
					{rowVirtualizer.getVirtualItems().map((virtualRow) => {
						const row = rows[virtualRow.index]!;
						return (
							<div
								key={`${row.kind}:${row.path}`}
								style={{
									position: "absolute",
									top: 0,
									left: 0,
									width: "100%",
									transform: `translateY(${virtualRow.start}px)`,
								}}
							>
								{renderRow(row)}
							</div>
						);
					})}
				</div>
			</div>
			{searchTerm.trim().length > 0 && rows.length === 1 && (
				<p className="shell-empty-state">No files match "{searchTerm}".</p>
			)}
		</div>
	);
}
