import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
		return <p className="shell-empty-state">No recent commits to review.</p>;
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
		<div className="shell-commit-list">
			{remoteStatus && (
				<div className="shell-commit-push-strip">
					<span className="shell-commit-push-strip__counts">
						<span>↑{remoteStatus.ahead}</span>
						<span>↓{remoteStatus.behind}</span>
					</span>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={pushDisabled}
						onClick={handlePushClick}
					>
						Push
					</Button>
					<ForcePushDialog
						open={forcePushOpen}
						behind={remoteStatus.behind}
						onOpenChange={setForcePushOpen}
						onConfirm={() => onPush?.(true) ?? Promise.resolve()}
					/>
				</div>
			)}
			<div className="shell-commit-list__target">{history.mergeTargetRef}</div>
			{rows.map((row, index) => {
				const isSelected = selectedCommitSha === row.sha;
				const showFiles = isSelected && activeDetail?.sha === row.sha;

				return (
					<div
						key={row.sha}
						className="shell-commit-list__row"
						data-selected={String(isSelected)}
						data-row-kind={row.rowKind}
						data-first={String(index === 0)}
						data-last={String(index === rows.length - 1)}
					>
						<button
							type="button"
							className="shell-commit-list__item"
							data-selected={String(isSelected)}
							data-row-kind={row.rowKind}
							onClick={() =>
								isSelected ? onDeselectCommit?.() : onSelectCommit(row.sha)
							}
						>
							<span
								className="shell-commit-list__graph-column"
								aria-hidden="true"
							>
								<span className="shell-commit-list__graph" />
							</span>
							<code className="shell-commit-list__sha">{row.shortSha}</code>
							<span className="shell-commit-list__subject">{row.subject}</span>
							{isSelected &&
							selectedCommitOpenCommentCount &&
							selectedCommitOpenCommentCount > 0 ? (
								<span
									className="shell-review-comment-badge"
									aria-label={`${selectedCommitOpenCommentCount} open review comments on files in this commit`}
								>
									[{selectedCommitOpenCommentCount}]
								</span>
							) : null}
						</button>
						{showFiles && (
							<div className="shell-commit-list__files">
								{activeDetail.files.map((file) => {
									const button = (
										<button
											key={file.path}
											type="button"
											className="shell-list__item shell-list__item--split"
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
											<ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
											<ContextMenuContent className="shell-toolbar-menu">
												<ContextMenuItem
													className="shell-toolbar-menu__item"
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
																// override — it'll read the working-tree copy.
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
			{/* Always mounted, visibility driven by `open`: unmounting a Radix
			    Dialog while it is still open skips its body pointer-events/aria
			    cleanup and freezes the app. */}
			<MarkdownPreviewModal
				workspaceId={workspaceId}
				worktreeId={worktreeId}
				relativePath={previewState?.path ?? ""}
				contentOverride={previewState?.content}
				open={previewState !== null}
				onClose={() => setPreviewState(null)}
			/>
		</div>
	);
}
