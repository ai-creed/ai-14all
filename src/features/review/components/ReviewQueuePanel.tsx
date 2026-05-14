import { useMemo } from "react";
import type { ReviewComment, ReviewCommentSource } from "../../../../shared/models/review-comment";
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
	onClearAddressed,
	onToggleHideAddressed,
	installCtaVisible,
	onOpenInstall,
}: Props) {
	const { active, other, openCount } = useMemo(() => {
		const visible = hideAddressed
			? comments.filter((c) => c.status !== "addressed")
			: comments;
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

	const totalAddressed = comments.filter((c) => c.status === "addressed").length;

	return (
		<aside className="shell-review-queue" data-testid="review-queue-panel">
			<header className="shell-review-queue__header">
				<span className="shell-review-queue__title">Comments</span>
				<span className="shell-review-queue__count">{openCount} open</span>
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
						aria-label="Clear all addressed"
						onClick={onClearAddressed}
						disabled={totalAddressed === 0}
					>
						Clear all addressed
					</button>
				</div>
			</header>

			<section className="shell-review-queue__section">
				<h4>Active</h4>
				<FileGroups list={active} onJump={onJump} emptyText="No comments in this view." />
			</section>

			{other.length > 0 && (
				<section className="shell-review-queue__section">
					<h4>Other modes</h4>
					<FileGroups list={other} onJump={onJump} emptyText="" />
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
						📝 L{pendingDraft.startLine}
						{pendingDraft.startLine !== pendingDraft.endLine
							? `–${pendingDraft.endLine}` : ""} in {pendingDraft.filePath}
					</button>
				</section>
			)}

			{installCtaVisible && onOpenInstall && (
				<AgentInstallCta onOpenInstall={onOpenInstall} />
			)}
		</aside>
	);
}

function FileGroups({
	list,
	onJump,
	emptyText,
}: {
	list: ReviewComment[];
	onJump: (c: ReviewComment) => void;
	emptyText: string;
}) {
	if (list.length === 0) {
		return emptyText ? <p className="shell-empty-state">{emptyText}</p> : null;
	}
	const byFile = new Map<string, ReviewComment[]>();
	for (const c of list) {
		const arr = byFile.get(c.filePath) ?? [];
		arr.push(c);
		byFile.set(c.filePath, arr);
	}
	return (
		<ul className="shell-review-queue__files">
			{[...byFile.entries()].map(([filePath, items]) => (
				<li key={filePath}>
					<div className="shell-review-queue__filepath" title={filePath}>{filePath}</div>
					<ul>
						{items.map((c) => (
							<li key={c.id} className="shell-review-queue__row" data-status={c.status}>
								<button type="button" onClick={() => onJump(c)}>
									<span>L{c.startLine}{c.startLine !== c.endLine ? `–${c.endLine}` : ""}</span>
									<span>{firstLine(c.body)}</span>
									<span aria-hidden="true">{c.status === "open" ? "●" : "✓"}</span>
								</button>
							</li>
						))}
					</ul>
				</li>
			))}
		</ul>
	);
}

function firstLine(s: string): string {
	const i = s.indexOf("\n");
	return i === -1 ? s : s.slice(0, i);
}
