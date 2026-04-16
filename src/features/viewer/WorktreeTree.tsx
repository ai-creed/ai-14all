import { useEffect, useMemo, useRef, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { GitChange, GitChangeStatus } from "../../../shared/models/git-change";
import { files } from "../../lib/desktop-client";
import { buildFileTree, WORKTREE_TREE_ROOT_PATH } from "./build-file-tree";
import { flattenTreeToRows, type VisibleRow } from "./flatten-tree-to-rows";

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
			const list = await files.listTracked(workspaceId, worktreeId);
			if (requestIdRef.current !== myId) return;
			if (capturedWorktreeId !== worktreeId) return;
			setFileList(list);
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

	function renderRow(row: VisibleRow) {
		const isDir = row.kind === "dir";
		const isRoot = row.kind === "dir" && row.path === WORKTREE_TREE_ROOT_PATH;
		const handleClick = () => {
			if (isRoot) return;
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
				className={
					isDir
						? "shell-list__item shell-list__item--tree shell-list__item--dir"
						: "shell-list__item shell-list__item--tree"
				}
				data-selected={!isDir && row.path === selectedFile}
				style={{ paddingLeft: `${row.depth * 12}px` }}
				onClick={handleClick}
			>
				{row.name}
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
		const isMarkdown = row.kind === "file" && row.name.endsWith(".md");
		if (isMarkdown && props.onPreviewMarkdown) {
			const handler = props.onPreviewMarkdown;
			return (
				<ContextMenu.Root key={`${row.kind}:${row.path}`}>
					<ContextMenu.Trigger asChild>{body}</ContextMenu.Trigger>
					<ContextMenu.Portal>
						<ContextMenu.Content className="shell-toolbar-menu">
							<ContextMenu.Item
								className="shell-toolbar-menu__item"
								onSelect={() => handler(row.path)}
							>
								Preview
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
			);
		}
		return <div key={`${row.kind}:${row.path}`}>{body}</div>;
	}

	if (loading && fileList.length === 0) {
		return (
			<div className="shell-rail__message">
				<p className="shell-empty-state">Loading files…</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="shell-rail__message">
				<p className="shell-error">
					Unable to load files: {error}
				</p>
			</div>
		);
	}

	return (
		<div className="shell-list">
			{gitSummaryError && (
				<p className="shell-inline-warning">
					{gitSummaryMessage ?? "Git summary unavailable — file badges are hidden."}
				</p>
			)}
			<input
				type="text"
				className="shell-tree-search"
				placeholder="Search files…"
				value={inputTerm}
				onChange={(e) => setInputTerm(e.target.value)}
				aria-label="Search files"
			/>
			{fileList.length === 0 && !loading && (
				<p className="shell-empty-state">No files in this worktree.</p>
			)}
			<div
				ref={scrollParentRef}
				className="shell-tree-scroll"
				style={{ overflow: "auto" }}
			>
				<div>{rows.map(renderRow)}</div>
			</div>
			{searchTerm.trim().length > 0 && rows.length === 1 && (
				<p className="shell-empty-state">No files match "{searchTerm}".</p>
			)}
		</div>
	);
}
