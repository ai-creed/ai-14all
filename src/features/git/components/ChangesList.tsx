import { useEffect, useState } from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { GitChange } from "../../../../shared/models/git-change";
import { MarkdownPreviewModal } from "../../viewer/components/MarkdownPreviewModal";

type Props = {
	workspaceId: string;
	worktreeId: string;
	changes: GitChange[];
	selectedPath: string | null;
	onSelect: (relativePath: string) => void;
	onDiscardChange: (relativePath: string) => void;
	gitSummaryError?: boolean;
	gitSummaryStale?: boolean;
	gitSummaryMessage?: string | null;
	openCommentCounts?: Record<string, number>;
};

export function ChangesList({
	workspaceId,
	worktreeId,
	changes,
	selectedPath,
	onSelect,
	onDiscardChange,
	gitSummaryError,
	gitSummaryStale,
	gitSummaryMessage,
	openCommentCounts,
}: Props) {
	const [previewPath, setPreviewPath] = useState<string | null>(null);

	useEffect(() => {
		setPreviewPath(null);
	}, [workspaceId, worktreeId]);

	if (gitSummaryError) {
		return (
			<div className="shell-rail__message">
				<p className="shell-empty-state">Unable to load Git data.</p>
			</div>
		);
	}

	if (changes.length === 0 && !gitSummaryMessage) {
		return (
			<div className="shell-rail__message">
				<p className="shell-empty-state">No changed files.</p>
			</div>
		);
	}

	return (
		<>
			{gitSummaryMessage && (
				<p className={gitSummaryStale ? "shell-inline-warning" : "shell-error"}>
					{gitSummaryMessage}
				</p>
			)}
			{changes.length === 0 ? (
				<div className="shell-rail__message">
					<p className="shell-empty-state">No changed files.</p>
				</div>
			) : (
				<div className="shell-list">
					{changes.map((change) => {
						const button = (
							<button
								key={change.path}
								type="button"
								className="shell-list__item shell-list__item--split"
								data-selected={String(selectedPath === change.path)}
								onClick={() => onSelect(change.path)}
							>
								<span>{change.path}</span>
								{openCommentCounts?.[change.path] ? (
									<span
										className="shell-review-comment-badge"
										aria-label={`${openCommentCounts[change.path]} open review comments`}
									>
										[{openCommentCounts[change.path]}]
									</span>
								) : null}
								<strong>{change.status}</strong>
							</button>
						);

						const isMd = change.path.endsWith(".md");

						return (
							<ContextMenu key={change.path}>
								<ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
								<ContextMenuContent className="shell-toolbar-menu">
									{isMd && (
										<ContextMenuItem
											className="shell-toolbar-menu__item"
											onSelect={() => setPreviewPath(change.path)}
										>
											Preview
										</ContextMenuItem>
									)}
									<ContextMenuItem
										className="shell-toolbar-menu__item shell-toolbar-menu__item--danger"
										onSelect={() => onDiscardChange(change.path)}
									>
										Discard changes
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						);
					})}
				</div>
			)}
			{/* Always mounted, visibility driven by `open`: unmounting a Radix
			    Dialog while it is still open skips its body pointer-events/aria
			    cleanup and freezes the app. */}
			<MarkdownPreviewModal
				workspaceId={workspaceId}
				worktreeId={worktreeId}
				relativePath={previewPath ?? ""}
				open={previewPath !== null}
				onClose={() => setPreviewPath(null)}
			/>
		</>
	);
}
