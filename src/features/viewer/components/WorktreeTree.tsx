import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type {
	GitChange,
	GitChangeStatus,
} from "../../../../shared/models/git-change";
import { files } from "../../../lib/desktop-client";
import { isEditable } from "../../../../shared/editor/editable-files";
import {
	buildFileTree,
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
	onEditFile?: (relativePath: string) => void;
	changedFiles: GitChange[];
	gitSummaryError?: boolean;
	gitSummaryMessage?: string | null;
	expandedPaths: string[];
	onExpandedPathsChange: (worktreeId: string, paths: string[]) => void;
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
	} = props;

	const [fileList, setFileList] = useState<string[]>([]);
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
	}, [workspaceId, worktreeId]);

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
				includeIgnored: false,
			});
			if (requestIdRef.current !== myId) return;
			if (capturedWorktreeId !== worktreeId) return;
			setFileList(entries.map((e) => e.path));
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
					isDir
						? "shell-list__item shell-list__item--tree shell-list__item--dir"
						: "shell-list__item shell-list__item--tree"
				}
				data-selected={!isDir && row.path === selectedFile}
				style={{ paddingLeft: `${row.depth * 16}px` }}
				onClick={handleClick}
			>
				{isDir && (
					<span className="shell-tree-chevron" aria-hidden="true">
						{row.expanded ? "▾" : "▸"}
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
				<ContextMenu.Root key={`${row.kind}:${row.path}`}>
					<ContextMenu.Trigger asChild>{body}</ContextMenu.Trigger>
					<ContextMenu.Portal>
						<ContextMenu.Content className="shell-toolbar-menu">
							<ContextMenu.Item
								className="shell-toolbar-menu__item"
								onSelect={() => reload()}
							>
								Refresh
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
			);
		}
		if (row.kind === "file") {
			const name = row.name;
			const isMarkdown = name.endsWith(".md");
			const editFile = props.onEditFile;
			const previewMarkdown = props.onPreviewMarkdown;
			const canEdit = isEditable(name) && editFile != null;
			const canPreview = isMarkdown && previewMarkdown != null;
			if (!canPreview && !canEdit) {
				return <div key={`${row.kind}:${row.path}`}>{body}</div>;
			}
			return (
				<ContextMenu.Root key={`${row.kind}:${row.path}`}>
					<ContextMenu.Trigger asChild>{body}</ContextMenu.Trigger>
					<ContextMenu.Portal>
						<ContextMenu.Content className="shell-toolbar-menu">
							{canPreview && previewMarkdown ? (
								<ContextMenu.Item
									className="shell-toolbar-menu__item"
									onSelect={() => previewMarkdown(row.path)}
								>
									Preview
								</ContextMenu.Item>
							) : null}
							{canEdit && editFile ? (
								<ContextMenu.Item
									className="shell-toolbar-menu__item"
									onSelect={() => editFile(row.path)}
								>
									Edit
								</ContextMenu.Item>
							) : null}
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
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
			<input
				type="text"
				className="shell-input shell-tree-search"
				placeholder="Search files…"
				value={inputTerm}
				onChange={(e) => setInputTerm(e.target.value)}
				aria-label="Search files"
				disabled={!!error}
			/>
			{loading && fileList.length === 0 && (
				<p className="shell-empty-state">Loading files…</p>
			)}
			{fileList.length === 0 && !loading && (
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
