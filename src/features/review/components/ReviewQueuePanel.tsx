import { useMemo } from "react";
import { Icon } from "@/components/ui/icon";
import type {
	ReviewComment,
	ReviewCommentSource,
} from "../../../../shared/models/review-comment";
import {
	filterHideAddressed,
	firstLine,
	groupCommentsByFile,
} from "../logic/group-comments";
import { AgentInstallCta } from "./AgentInstallCta";

type ActiveMode =
	| { kind: "changes" }
	| { kind: "commits"; commitSha: string | null }
	| { kind: "files" };

type PendingDraft = {
	filePath: string;
	startLine: number;
	endLine: number;
	snippet: string;
	body: string;
	source: ReviewCommentSource;
	commitSha: string | null;
};

type Props = {
	activeMode: ActiveMode;
	comments: ReviewComment[];
	hideAddressed: boolean;
	pendingDraft?: PendingDraft | null;
	onJumpToPendingDraft?: (draft: PendingDraft) => void;
	onJump: (c: ReviewComment) => void;
	onToggleAddressed: (id: string) => void;
	onDelete: (id: string) => void;
	onClearAddressed: () => void;
	onToggleHideAddressed: () => void;
	installCtaVisible?: boolean;
	onOpenInstall?: () => void;
};

function isInActiveMode(c: ReviewComment, m: ActiveMode): boolean {
	if (m.kind === "files") return false;
	if (m.kind === "changes") return c.source === "working-tree";
	return c.source === "commit" && c.commitSha === m.commitSha;
}

export function ReviewQueuePanel({
	activeMode,
	comments,
	hideAddressed,
	pendingDraft,
	onJumpToPendingDraft,
	onJump,
	onToggleAddressed,
	onDelete,
	onClearAddressed,
	onToggleHideAddressed,
	installCtaVisible,
	onOpenInstall,
}: Props) {
	const { active, other, openCount } = useMemo(() => {
		const visible = filterHideAddressed(comments, hideAddressed);
		const active: ReviewComment[] = [];
		const other: ReviewComment[] = [];
		let openCount = 0;
		for (const c of visible) {
			if (c.status === "open") openCount++;
			if (isInActiveMode(c, activeMode)) active.push(c);
			else other.push(c);
		}
		return { active, other, openCount };
	}, [comments, activeMode, hideAddressed]);

	const totalAddressed = comments.filter(
		(c) => c.status === "addressed",
	).length;

	return (
		<aside className="shell-review-queue" data-testid="review-queue-panel">
			<header className="shell-review-queue__header">
				<div className="shell-review-queue__header-row">
					<span className="shell-review-queue__title">Comments</span>
					<span className="shell-review-queue__count">{openCount} open</span>
				</div>
				<div className="shell-review-queue__actions">
					<button
						type="button"
						onClick={onToggleHideAddressed}
						aria-pressed={hideAddressed}
					>
						{hideAddressed ? "Show addressed" : "Hide addressed"}
					</button>
					<button
						type="button"
						className="shell-review-queue__btn--danger"
						aria-label="Clear addressed"
						onClick={onClearAddressed}
						disabled={totalAddressed === 0}
					>
						Clear addressed
					</button>
				</div>
			</header>

			<div className="shell-review-queue__body">
				<section className="shell-review-queue__section">
					<h4>Active</h4>
					<FileGroups
						list={active}
						onJump={onJump}
						onToggleAddressed={onToggleAddressed}
						onDelete={onDelete}
						emptyText="No comments in this view."
					/>
				</section>

				{other.length > 0 && (
					<section className="shell-review-queue__section">
						<h4>Other modes</h4>
						<FileGroups
							list={other}
							onJump={onJump}
							onToggleAddressed={onToggleAddressed}
							onDelete={onDelete}
							emptyText=""
						/>
					</section>
				)}

				{pendingDraft && onJumpToPendingDraft && (
					<section className="shell-review-queue__section">
						<h4>Pending draft</h4>
						<button
							type="button"
							className="shell-review-queue__pending-draft"
							onClick={() => onJumpToPendingDraft(pendingDraft)}
						>
							L{pendingDraft.startLine}
							{pendingDraft.startLine !== pendingDraft.endLine
								? `–${pendingDraft.endLine}`
								: ""}{" "}
							· {pendingDraft.filePath}
						</button>
					</section>
				)}

				{installCtaVisible && onOpenInstall && (
					<AgentInstallCta onOpenInstall={onOpenInstall} />
				)}
			</div>
		</aside>
	);
}

function FileGroups({
	list,
	onJump,
	onToggleAddressed,
	onDelete,
	emptyText,
}: {
	list: ReviewComment[];
	onJump: (c: ReviewComment) => void;
	onToggleAddressed: (id: string) => void;
	onDelete: (id: string) => void;
	emptyText: string;
}) {
	if (list.length === 0) {
		return emptyText ? <p className="shell-empty-state">{emptyText}</p> : null;
	}
	return (
		<ul className="shell-review-queue__files">
			{groupCommentsByFile(list).map(([filePath, items]) => (
				<li key={filePath}>
					<div className="shell-review-queue__filepath" title={filePath}>
						{filePath}
					</div>
					<ul>
						{items.map((c) => (
							<li
								key={c.id}
								className="shell-review-queue__row"
								data-status={c.status}
							>
								<div className="shell-review-queue__row-inner">
									<button
										type="button"
										className="shell-review-queue__row-jump"
										onClick={() => onJump(c)}
									>
										<span>
											L{c.startLine}
											{c.startLine !== c.endLine ? `–${c.endLine}` : ""}
										</span>
										<span>{firstLine(c.body)}</span>
									</button>
									<div className="shell-review-queue__row-actions">
										<button
											type="button"
											aria-label={c.status === "open" ? "Address" : "Reopen"}
											onClick={() => onToggleAddressed(c.id)}
										>
											{c.status === "open" ? (
												<Icon name="check" />
											) : (
												<Icon name="refresh" fallback="↺" />
											)}
										</button>
										<button
											type="button"
											aria-label="Delete comment"
											onClick={() => onDelete(c.id)}
										>
											<Icon name="close" fallback="×" />
										</button>
									</div>
								</div>
							</li>
						))}
					</ul>
				</li>
			))}
		</ul>
	);
}
