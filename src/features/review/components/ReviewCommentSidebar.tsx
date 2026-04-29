import type { ReviewComment } from "../../../../shared/models/review-comment";
import { AgentInstallCta } from "./AgentInstallCta";
import { ReviewCommentCard } from "../components/ReviewCommentCard";
import { ReviewCommentForm } from "../components/ReviewCommentForm";

export type NewCommentDraft = {
	filePath: string;
	startLine: number;
	endLine: number;
	snippet: string;
};

type Props = {
	filePath: string | null;
	comments: ReviewComment[];
	addingForFile: NewCommentDraft | null;
	onScrollTo: (range: { startLine: number; endLine: number }) => void;
	onToggleAddressed: (commentId: string) => void;
	onDelete: (commentId: string) => void;
	onSubmitNew: (draft: NewCommentDraft, body: string) => void;
	onCancelNew: () => void;
	installCtaVisible?: boolean;
	onOpenInstall?: () => void;
};

export function ReviewCommentSidebar({
	filePath,
	comments,
	addingForFile,
	onScrollTo,
	onToggleAddressed,
	onDelete,
	onSubmitNew,
	onCancelNew,
	installCtaVisible,
	onOpenInstall,
}: Props) {
	const fileComments = filePath
		? comments
				.filter((c) => c.filePath === filePath)
				.sort((a, b) => a.startLine - b.startLine)
		: [];
	const openCount = fileComments.filter((c) => c.status === "open").length;

	return (
		<aside
			className="shell-review-comment-sidebar"
			data-testid="review-comment-sidebar"
		>
			<header className="shell-review-comment-sidebar__header">
				<div className="shell-review-comment-sidebar__header-row">
					<svg
						className="shell-review-comment-sidebar__icon"
						width="13"
						height="13"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M2 2h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5l-3 2V3a1 1 0 0 1 1-1z"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinejoin="round"
						/>
					</svg>
					<span className="shell-review-comment-sidebar__title">Comments</span>
					<span
						className="shell-review-comment-sidebar__count"
						data-active={openCount > 0 ? "true" : "false"}
					>
						{openCount > 0 && (
							<span className="shell-chip-bar__note-dot" aria-hidden="true" />
						)}
						{openCount} open
					</span>
				</div>
				{filePath && (
					<span className="shell-review-comment-sidebar__path" title={filePath}>
						{filePath}
					</span>
				)}
			</header>
			<div className="shell-review-comment-sidebar__list">
				{addingForFile && addingForFile.filePath === filePath && (
					<ReviewCommentForm
						onSave={(body) => onSubmitNew(addingForFile, body)}
						onCancel={onCancelNew}
					/>
				)}
				{fileComments.length === 0 && !addingForFile ? (
					<p className="shell-empty-state">
						No review comments. Hover a line in the diff to add one.
					</p>
				) : (
					fileComments.map((c) => (
						<ReviewCommentCard
							key={c.id}
							comment={c}
							onScrollTo={onScrollTo}
							onToggleAddressed={onToggleAddressed}
							onDelete={onDelete}
						/>
					))
				)}
			</div>
			{installCtaVisible && onOpenInstall && (
				<AgentInstallCta onOpenInstall={onOpenInstall} />
			)}
		</aside>
	);
}
