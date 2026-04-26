import { useEffect, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { GitChange } from "../../../shared/models/git-change";
import { MarkdownPreviewModal } from "../viewer/MarkdownPreviewModal";

type Props = {
	worktreePath: string;
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
	worktreePath,
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
	}, [worktreePath]);

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
							<ContextMenu.Root key={change.path}>
								<ContextMenu.Trigger asChild>{button}</ContextMenu.Trigger>
								<ContextMenu.Portal>
									<ContextMenu.Content className="shell-toolbar-menu">
										{isMd && (
											<ContextMenu.Item
												className="shell-toolbar-menu__item"
												onSelect={() => setPreviewPath(change.path)}
											>
												Preview
											</ContextMenu.Item>
										)}
										<ContextMenu.Item
											className="shell-toolbar-menu__item shell-toolbar-menu__item--danger"
											onSelect={() => onDiscardChange(change.path)}
										>
											Discard changes
										</ContextMenu.Item>
									</ContextMenu.Content>
								</ContextMenu.Portal>
							</ContextMenu.Root>
						);
					})}
				</div>
			)}
			{previewPath !== null && (
				<MarkdownPreviewModal
					worktreePath={worktreePath}
					relativePath={previewPath}
					open={true}
					onClose={() => setPreviewPath(null)}
				/>
			)}
		</>
	);
}
