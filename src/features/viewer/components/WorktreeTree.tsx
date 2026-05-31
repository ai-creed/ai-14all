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

export type WorktreeTreeProps = {
	workspaceId: string;
	worktreeId: string;
	worktreeLabel: string;
	selectedFile: string | null;
	onSelect: (relativePath: string) => void;
	onPreviewMarkdown?: (relativePath: string) => void;
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
	const [inputTerm, setInputTerm] = useState("");
	const [searchTerm, setSearchTerm] = useState("");
	const requestIdRef = useRef(0);
	const didInitExpandRef = useRef<string | null>(null);
	const scrollParentRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		reload();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [workspaceId, worktreeId, showIgnored]);

	useEffect(() => {
		const handle = setTimeout(() => setSearchTerm(inputTerm), 120);
		return () => clearTimeout(handle);
	}, [inputTerm]);

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
				className={`flex items-center py-1 px-2 w-[calc(100%-8px)] text-xs leading-none bg-transparent overflow-hidden cursor-pointer ${isDir ? "text-secondary-foreground font-semibold italic" : ""} ${row.ignored ? "opacity-55" : ""}`}
				data-selected={!isDir && row.path === selectedFile}
				data-ignored={row.ignored ? "true" : undefined}
				style={{ paddingLeft: `${row.depth * 16}px` }}
				onClick={handleClick}
			>
				{isDir && (
					<span className="inline-block w-[1em] text-center text-[1.3em] text-muted-foreground mr-1 shrink-0" aria-hidden="true">
						{row.expanded ? "\u25BE" : "\u25B8"}
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
						className="ml-1 text-xs font-semibold shrink-0"
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
					<ContextMenuContent className="min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
						<ContextMenuItem
							className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
							onSelect={() => reload()}
						>
							Refresh
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			);
		}
		if (row.kind === "file") {
			const name = row.name;
			const isMarkdown = name.endsWith(".md");
			const previewMarkdown = props.onPreviewMarkdown;
			const canPreview = isMarkdown && previewMarkdown != null;
			if (!canPreview) {
				return <div key={`${row.kind}:${row.path}`}>{body}</div>;
			}
			return (
				<ContextMenu key={`${row.kind}:${row.path}`}>
					<ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
					<ContextMenuContent className="min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
						<ContextMenuItem
							className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
							onSelect={() => previewMarkdown(row.path)}
						>
							Preview
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			);
		}
		return <div key={`${row.kind}:${row.path}`}>{body}</div>;
	}

	return (
		<div className="grid gap-1" style={{ marginLeft: "8px" }}>
			{gitSummaryError && (
				<p className="text-[var(--warning)] text-sm">
					{gitSummaryMessage ??
						"Git summary unavailable \u2014 file badges are hidden."}
				</p>
			)}
			{error && <p className="text-destructive">Unable to load files: {error}</p>}
			<div className="flex flex-col items-stretch gap-1 pr-2">
				<ToggleSwitch
					id="worktree-tree-show-gitignored"
					checked={showIgnored}
					onChange={onToggleShowIgnored}
					label="Show gitignored"
					ariaLabel="Show gitignored files"
				/>
				<input
					type="text"
					className="w-auto h-8 my-2 p-1 appearance-none text-foreground bg-card border border-[var(--panel-border-strong)] rounded-sm font-[inherit] hover:not(:disabled):not(:focus):border-muted-foreground focus-visible:outline-none focus-visible:border-ring"
					placeholder="Search files\u2026"
					value={inputTerm}
					onChange={(e) => setInputTerm(e.target.value)}
					aria-label="Search files"
					disabled={!!error}
				/>
			</div>
			{loading && fileCount === 0 && (
				<p className="text-secondary-foreground">Loading files\u2026</p>
			)}
			{fileCount === 0 && !loading && (
				<p className="text-secondary-foreground">No files in this worktree.</p>
			)}
			<div
				ref={scrollParentRef}
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
				<p className="text-secondary-foreground">No files match &quot;{searchTerm}&quot;.</p>
			)}
		</div>
	);
}
