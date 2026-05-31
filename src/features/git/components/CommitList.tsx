import { useEffect, useState } from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { buildLinearCommitGraph } from "../logic/build-linear-commit-graph.js";
import type {
	GitCommitHistory,
	GitCommitDetail,
} from "../../../../shared/models/git-commit-review.js";
import type { RemoteStatus } from "../../../../shared/models/git-remote-status.js";
import { MarkdownPreviewModal } from "../../viewer/components/MarkdownPreviewModal";
import { ForcePushDialog } from "../components/ForcePushDialog";
import { git } from "../../../lib/desktop-client";

type Props = {
	workspaceId: string;
	worktreeId: string;
	history: GitCommitHistory;
	selectedCommitSha: string | null;
	selectedCommitFilePath: string | null;
	activeDetail: GitCommitDetail | null;
	onSelectCommit: (sha: string) => void;
	onDeselectCommit?: () => void;
	onSelectCommitFile: (relativePath: string) => void;
	remoteStatus?: RemoteStatus | null;
	onPush?: (force: boolean) => Promise<void>;
	selectedCommitOpenCommentCount?: number;
};

export function CommitList({
	workspaceId,
	worktreeId,
	history,
	selectedCommitSha,
	selectedCommitFilePath,
	activeDetail,
	onSelectCommit,
	onDeselectCommit,
	onSelectCommitFile,
	remoteStatus,
	onPush,
	selectedCommitOpenCommentCount,
}: Props) {
	const [previewState, setPreviewState] = useState<{
		path: string;
		content: string;
	} | null>(null);
	const [forcePushOpen, setForcePushOpen] = useState(false);

	useEffect(() => {
		setPreviewState(null);
	}, [workspaceId, worktreeId, activeDetail?.sha]);

	if (!history.mergeTargetRef || history.entries.length === 0) {
		return <p className="text-secondary-foreground">No recent commits to review.</p>;
	}

	const rows = buildLinearCommitGraph(history.entries);
	const pushDisabled =
		!remoteStatus?.hasRemote || (remoteStatus?.ahead ?? 0) === 0;

	function handlePushClick() {
		if (!remoteStatus || !onPush) return;
		if (remoteStatus.behind > 0) {
			setForcePushOpen(true);
		} else {
			void onPush(false);
		}
	}

	return (
		<div className="grid gap-0.5 p-2">
			{remoteStatus && (
				<div className="flex items-center gap-3 px-3 py-2 border-b border-border text-[0.75rem]">
					<span className="flex gap-2 text-muted-foreground flex-1">
						<span>&uarr;{remoteStatus.ahead}</span>
						<span>&darr;{remoteStatus.behind}</span>
					</span>
					<button
						type="button"
						className="h-[22px] px-2.5 text-[0.7rem] leading-none text-foreground bg-card border border-border rounded-sm cursor-pointer hover:border-muted-foreground disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-1"
						disabled={pushDisabled}
						onClick={handlePushClick}
					>
						Push
					</button>
					<ForcePushDialog
						open={forcePushOpen}
						behind={remoteStatus.behind}
						onOpenChange={setForcePushOpen}
						onConfirm={() => onPush?.(true) ?? Promise.resolve()}
					/>
				</div>
			)}
			<div className="px-2 py-1 text-[0.8em] text-muted-foreground font-[var(--font-ui)]">{history.mergeTargetRef}</div>
			{rows.map((row, index) => {
				const isSelected = selectedCommitSha === row.sha;
				const showFiles = isSelected && activeDetail?.sha === row.sha;

				return (
					<div
						key={row.sha}
						className="relative grid gap-0.5 before:content-[''] before:absolute before:left-4 before:top-0 before:bottom-0 before:w-px before:bg-[color-mix(in_srgb,var(--ring)_40%,transparent)] data-[row-kind=mergeTarget]:before:bg-[color-mix(in_srgb,var(--muted-foreground)_45%,transparent)] data-[first=true]:before:top-1/2 data-[last=true]:before:bottom-[calc(100%-18px)]"
						data-selected={String(isSelected)}
						data-row-kind={row.rowKind}
						data-first={String(index === 0)}
						data-last={String(index === rows.length - 1)}
					>
						<button
							type="button"
							className={`grid grid-cols-[16px_auto_1fr] gap-2 items-center w-full px-2 py-1.5 text-left text-foreground bg-transparent border border-transparent rounded-sm text-[0.82rem] leading-[1.25] cursor-pointer data-[selected=true]:bg-secondary data-[selected=true]:border-[var(--panel-border-strong)] ${row.rowKind === "mergeTarget" ? "text-muted-foreground" : ""}`}
							data-selected={String(isSelected)}
							onClick={() =>
								isSelected ? onDeselectCommit?.() : onSelectCommit(row.sha)
							}
						>
							<span
								className="flex items-center justify-center min-h-[22px] relative z-[1]"
								aria-hidden="true"
							>
								<span className={`block w-2 h-2 rounded-full ${row.rowKind === "mergeTarget" ? "bg-muted-foreground" : "bg-ring"}`} />
							</span>
							<code className="block text-[0.82rem] leading-[1.2] self-center min-w-[5.75ch] text-[var(--sha)]">{row.shortSha}</code>
							<span className={`block text-[0.82rem] leading-[1.2] self-center overflow-hidden text-ellipsis whitespace-nowrap ${isSelected ? "text-foreground" : "text-secondary-foreground"}`}>{row.subject}</span>
							{isSelected &&
							selectedCommitOpenCommentCount &&
							selectedCommitOpenCommentCount > 0 ? (
								<span
									className="text-muted-foreground text-[0.75rem] shrink-0"
									aria-label={`${selectedCommitOpenCommentCount} open review comments on files in this commit`}
								>
									[{selectedCommitOpenCommentCount}]
								</span>
							) : null}
						</button>
						{showFiles && (
							<div className="grid gap-0.5 pl-9 mt-0">
								{activeDetail.files.map((file) => {
									const button = (
										<button
											key={file.path}
											type="button"
											className="w-full flex justify-between items-center gap-3 px-2.5 py-2 text-left text-foreground bg-transparent border border-transparent rounded-sm cursor-pointer text-[0.8rem] leading-[1.35] data-[selected=true]:bg-secondary data-[selected=true]:border-[var(--panel-border-strong)]"
											data-selected={String(
												selectedCommitFilePath === file.path,
											)}
											onClick={() => onSelectCommitFile(file.path)}
										>
											<span>{file.path}</span>
											<strong>{file.status}</strong>
										</button>
									);

									if (!file.path.endsWith(".md") || file.status === "D") {
										return button;
									}

									return (
										<ContextMenu key={file.path}>
											<ContextMenuTrigger asChild>
												{button}
											</ContextMenuTrigger>
											<ContextMenuContent className="min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
												<ContextMenuItem
													className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
													onSelect={() => {
														if (!activeDetail) return;
														// Lazy-fetch the modified blob at the commit
														// for the preview override. `readCommitFileDiff`
														// returns the same shape the eager flow used.
														void git
															.readCommitFileDiff(
																workspaceId,
																worktreeId,
																activeDetail.sha,
																file,
															)
															.then((diff) => {
																setPreviewState({
																	path: file.path,
																	content: diff.modifiedContent,
																});
															})
															.catch(() => {
																// Fall back to opening the modal without an
																// override -- it'll read the working-tree copy.
																setPreviewState({
																	path: file.path,
																	content: "",
																});
															});
													}}
												>
													Preview
												</ContextMenuItem>
											</ContextMenuContent>
										</ContextMenu>
									);
								})}
							</div>
						)}
					</div>
				);
			})}
			{previewState !== null && (
				<MarkdownPreviewModal
					workspaceId={workspaceId}
					worktreeId={worktreeId}
					relativePath={previewState.path}
					contentOverride={previewState.content}
					open={true}
					onClose={() => setPreviewState(null)}
				/>
			)}
		</div>
	);
}
