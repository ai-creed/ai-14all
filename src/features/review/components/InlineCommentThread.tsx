import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReviewComment } from "../../../../shared/models/review-comment";
import type { ThreadActions } from "../logic/inline-thread-mount";

type Props = {
	comment: ReviewComment;
	onSave: (body: string) => Promise<boolean>;
	onToggleAddressed: () => void;
	onDelete: () => void;
	onCancelEdit: () => void;
	onMeasureChange: () => void;
	onRegisterActions?: (actions: ThreadActions | null) => void;
};

export function InlineCommentThread({
	comment,
	onSave,
	onToggleAddressed,
	onDelete,
	onCancelEdit,
	onMeasureChange,
	onRegisterActions,
}: Props) {
	const [editing, setEditing] = useState(false);
	const [expanded, setExpanded] = useState(comment.status === "open");
	const [draft, setDraft] = useState(comment.body);
	const [saving, setSaving] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	const save = async () => {
		if (saving || draft.trim().length === 0) return;
		setSaving(true);
		try {
			const ok = await onSave(draft.trim());
			if (ok) setEditing(false);
		} finally {
			setSaving(false);
		}
	};

	useLayoutEffect(() => {
		onMeasureChange();
	}, [editing, expanded, comment.status, comment.body, onMeasureChange]);

	useEffect(() => {
		if (comment.status === "open") setExpanded(true);
	}, [comment.status, comment.id]);

	useEffect(() => {
		onRegisterActions?.({
			openEdit: () => {
				if (comment.status === "open") setEditing(true);
			},
		});
		return () => onRegisterActions?.(null);
	}, [comment.id, comment.status, onRegisterActions]);

	if (comment.status === "addressed" && !expanded) {
		return (
			<div
				ref={rootRef}
				className="shell-inline-thread"
				data-state="addressed-strip"
			>
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
					<span className="shell-inline-thread__strip-body">
						{firstLine(comment.body)}
					</span>
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
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void save();
						} else if (e.key === "Escape") {
							e.preventDefault();
							if (
								draft === comment.body ||
								window.confirm("Discard changes to this comment?")
							) {
								setEditing(false);
								setDraft(comment.body);
							}
						}
					}}
				/>
				<div className="shell-inline-thread__actions">
					<button
						type="button"
						onClick={() => {
							setEditing(false);
							setDraft(comment.body);
							onCancelEdit();
						}}
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={saving || draft.trim().length === 0}
						onClick={() => void save()}
					>
						Save
					</button>
				</div>
			</div>
		);
	}

	const isAddressed = comment.status === "addressed";

	return (
		<div
			ref={rootRef}
			className="shell-inline-thread"
			data-state={isAddressed ? "addressed-expanded" : "open"}
		>
			<header className="shell-inline-thread__header">
				<span>
					L{comment.startLine}
					{comment.startLine !== comment.endLine ? `–${comment.endLine}` : ""}
				</span>
				<span
					className="shell-inline-thread__status"
					data-status={comment.status}
				>
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
				<button
					type="button"
					aria-label="Edit comment"
					onClick={() => setEditing(true)}
				>
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
