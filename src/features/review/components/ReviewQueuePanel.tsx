import { useMemo } from "react";
import type {
	ReviewComment,
	ReviewCommentSource,
} from "../../../../shared/models/review-comment";
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

	const totalAddressed = comments.filter(
		(c) => c.status === "addressed",
	).length;

	return (
		<aside className="grid grid-rows-[auto_minmax(0,1fr)] h-full" data-testid="review-queue-panel">
			<header className="flex flex-col gap-1 px-3 py-2 border-b border-border">
				<div className="flex items-center justify-between">
					<span className="text-sm font-semibold">Comments</span>
					<span className="text-xs text-muted-foreground">{openCount} open</span>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="text-xs text-muted-foreground hover:text-foreground"
						onClick={onToggleHideAddressed}
						aria-pressed={hideAddressed}
					>
						{hideAddressed ? "Show addressed" : "Hide addressed"}
					</button>
					<button
						type="button"
						className="text-xs text-destructive hover:text-destructive/80 disabled:opacity-50"
						aria-label="Clear addressed"
						onClick={onClearAddressed}
						disabled={totalAddressed === 0}
					>
						Clear addressed
					</button>
				</div>
			</header>

			<div className="overflow-y-auto">
				<section className="px-3 py-2">
					<h4 className="text-xs font-semibold text-muted-foreground mb-1">Active</h4>
					<FileGroups
						list={active}
						onJump={onJump}
						onToggleAddressed={onToggleAddressed}
						onDelete={onDelete}
						emptyText="No comments in this view."
					/>
				</section>

				{other.length > 0 && (
					<section className="px-3 py-2">
						<h4 className="text-xs font-semibold text-muted-foreground mb-1">Other modes</h4>
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
					<section className="px-3 py-2">
						<h4 className="text-xs font-semibold text-muted-foreground mb-1">Pending draft</h4>
						<button
							type="button"
							className="text-xs text-accent-foreground hover:underline"
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
		return emptyText ? <p className="text-sm text-muted-foreground italic p-4">{emptyText}</p> : null;
	}
	const byFile = new Map<string, ReviewComment[]>();
	for (const c of list) {
		const arr = byFile.get(c.filePath) ?? [];
		arr.push(c);
		byFile.set(c.filePath, arr);
	}
	return (
		<ul className="space-y-2">
			{[...byFile.entries()].map(([filePath, items]) => (
				<li key={filePath}>
					<div className="text-xs text-muted-foreground truncate px-1" title={filePath}>
						{filePath}
					</div>
					<ul>
						{items.map((c) => (
							<li
								key={c.id}
								className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/50 text-xs data-[status=addressed]:opacity-60"
								data-status={c.status}
							>
								<div className="flex items-center gap-1 flex-1 min-w-0">
									<button
										type="button"
										className="flex items-center gap-1 min-w-0 flex-1 text-left hover:underline"
										onClick={() => onJump(c)}
									>
										<span className="shrink-0 text-muted-foreground">
											L{c.startLine}
											{c.startLine !== c.endLine ? `–${c.endLine}` : ""}
										</span>
										<span className="truncate">{firstLine(c.body)}</span>
									</button>
									<div className="flex items-center gap-0.5 shrink-0">
										<button
											type="button"
											className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted"
											aria-label={c.status === "open" ? "Address" : "Reopen"}
											onClick={() => onToggleAddressed(c.id)}
										>
											{c.status === "open" ? "✓" : "↺"}
										</button>
										<button
											type="button"
											className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted"
											aria-label="Delete comment"
											onClick={() => onDelete(c.id)}
										>
											×
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

function firstLine(s: string): string {
	const i = s.indexOf("\n");
	return i === -1 ? s : s.slice(0, i);
}
