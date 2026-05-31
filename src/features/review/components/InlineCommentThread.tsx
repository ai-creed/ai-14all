import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReviewComment } from "../../../../shared/models/review-comment";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";

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
			<div
				ref={rootRef}
				className="border-l-2 border-[var(--pane-border-review)] bg-card p-3"
				data-state="addressed-strip"
			>
				<button
					type="button"
					className="flex items-center gap-2 text-xs text-muted-foreground w-full text-left hover:text-foreground"
					aria-label="Expand addressed comment"
					onClick={() => setExpanded(true)}
				>
					<span aria-hidden="true">✓</span>
					<span>
						L{comment.startLine}
						{comment.startLine !== comment.endLine ? `–${comment.endLine}` : ""}
					</span>
					<span className="truncate flex-1">
						{firstLine(comment.body)}
					</span>
				</button>
				<button
					type="button"
					aria-label="Reopen comment"
					className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-muted text-xs"
					onClick={onToggleAddressed}
				>
					↺
				</button>
			</div>
		);
	}

	if (editing) {
		return (
			<div ref={rootRef} className="border-l-2 border-[var(--pane-border-review)] bg-card p-3" data-state="editing">
				<Textarea
					value={draft}
					autoFocus
					onChange={(e) => setDraft(e.target.value)}
				/>
				<div className="flex gap-2 mt-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => {
							setEditing(false);
							setDraft(comment.body);
						}}
					>
						Cancel
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={draft.trim().length === 0}
						onClick={async () => {
							const ok = await onSave(draft.trim());
							if (ok) {
								setEditing(false);
							}
						}}
					>
						Save
					</Button>
				</div>
			</div>
		);
	}

	const isAddressed = comment.status === "addressed";

	return (
		<div
			ref={rootRef}
			className="border-l-2 border-[var(--pane-border-review)] bg-card p-3"
			data-state={isAddressed ? "addressed-expanded" : "open"}
		>
			<header className="flex items-center gap-2 text-xs text-muted-foreground">
				<span>
					L{comment.startLine}
					{comment.startLine !== comment.endLine ? `–${comment.endLine}` : ""}
				</span>
				<span
					className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-medium data-[status=open]:bg-yellow-500/20 data-[status=open]:text-yellow-700 dark:data-[status=open]:text-yellow-400 data-[status=addressed]:bg-green-500/20 data-[status=addressed]:text-green-700 dark:data-[status=addressed]:text-green-400"
					data-status={comment.status}
				>
					{isAddressed ? "addressed" : "open"}
				</span>
				<span className="text-xs text-muted-foreground">
					{relativeTime(comment.createdAt)}
				</span>
			</header>
			<p className="text-sm whitespace-pre-wrap break-words mt-2">{comment.body}</p>
			<footer className="flex gap-2 mt-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label={isAddressed ? "Reopen comment" : "Address comment"}
					onClick={onToggleAddressed}
				>
					{isAddressed ? "↺ Reopen" : "✓ Address"}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label="Edit comment"
					onClick={() => setEditing(true)}
				>
					Edit
				</Button>
				<Button type="button" variant="ghost" size="sm" aria-label="Delete comment" onClick={onDelete}>
					Delete
				</Button>
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
