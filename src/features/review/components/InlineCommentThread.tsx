import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReviewComment } from "../../../../shared/models/review-comment";

type Props = {
	comment: ReviewComment;
	onSave: (body: string) => Promise<boolean>;
	onToggleAddressed: () => void;
	onDelete: () => void;
	onMeasureChange: () => void;
};

export function InlineCommentThread({
	comment,
	onSave,
	onToggleAddressed,
	onDelete,
	onMeasureChange,
}: Props) {
	const [editing, setEditing] = useState(false);
	const [expanded, setExpanded] = useState(comment.status === "open");
	const [draft, setDraft] = useState(comment.body);
	const rootRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		onMeasureChange();
	}, [editing, expanded, comment.status, comment.body, onMeasureChange]);

	useEffect(() => {
		if (comment.status === "open") setExpanded(true);
	}, [comment.status, comment.id]);

	if (comment.status === "addressed" && !expanded) {
		return (
			<div ref={rootRef} className="shell-inline-thread" data-state="addressed-strip">
				<button
					type="button"
					className="shell-inline-thread__strip"
					aria-label="Expand addressed comment"
					onClick={() => setExpanded(true)}
				>
					<span aria-hidden="true">✓</span>
					<span>
						L{comment.startLine}
						{comment.startLine !== comment.endLine ? `–${comment.endLine}` : ""}
					</span>
					<span className="shell-inline-thread__strip-body">{firstLine(comment.body)}</span>
				</button>
				<button
					type="button"
					aria-label="Reopen comment"
					className="shell-inline-thread__icon-btn"
					onClick={onToggleAddressed}
				>
					↺
				</button>
			</div>
		);
	}

	if (editing) {
		return (
			<div ref={rootRef} className="shell-inline-thread" data-state="editing">
				<textarea
					className="shell-inline-thread__textarea"
					value={draft}
					autoFocus
					onChange={(e) => setDraft(e.target.value)}
				/>
				<div className="shell-inline-thread__actions">
					<button
						type="button"
						onClick={() => {
							setEditing(false);
							setDraft(comment.body);
						}}
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={draft.trim().length === 0}
						onClick={async () => {
							const ok = await onSave(draft.trim());
							if (ok) {
								setEditing(false);
							}
						}}
					>
						Save
					</button>
				</div>
			</div>
		);
	}

	const isAddressed = comment.status === "addressed";

	return (
		<div ref={rootRef} className="shell-inline-thread" data-state={isAddressed ? "addressed-expanded" : "open"}>
			<header className="shell-inline-thread__header">
				<span>
					L{comment.startLine}
					{comment.startLine !== comment.endLine ? `–${comment.endLine}` : ""}
				</span>
				<span className="shell-inline-thread__status" data-status={comment.status}>
					{isAddressed ? "addressed" : "open"}
				</span>
				<span className="shell-inline-thread__time">
					{relativeTime(comment.createdAt)}
				</span>
			</header>
			<p className="shell-inline-thread__body">{comment.body}</p>
			<footer className="shell-inline-thread__actions">
				<button
					type="button"
					aria-label={isAddressed ? "Reopen comment" : "Address comment"}
					onClick={onToggleAddressed}
				>
					{isAddressed ? "↺ Reopen" : "✓ Address"}
				</button>
				<button type="button" aria-label="Edit comment" onClick={() => setEditing(true)}>
					Edit
				</button>
				<button type="button" aria-label="Delete comment" onClick={onDelete}>
					Delete
				</button>
			</footer>
		</div>
	);
}

function firstLine(s: string): string {
	const i = s.indexOf("\n");
	return i === -1 ? s : s.slice(0, i);
}

function relativeTime(iso: string): string {
	const diffMs = Date.now() - Date.parse(iso);
	if (Number.isNaN(diffMs) || diffMs < 0) return "";
	const m = Math.floor(diffMs / 60000);
	if (m < 1) return "just now";
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}
