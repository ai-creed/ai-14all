// src/features/review/components/ReviewRailOverview.tsx
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { ReviewComment } from "../../../../shared/models/review-comment";
import {
	filterHideAddressed,
	firstLine,
	groupCommentsByFile,
} from "../logic/group-comments";

export const MAX_OVERVIEW_ROWS = 200;

type Props = {
	comments: ReviewComment[];
	hideAddressed: boolean;
	expanded: boolean;
	onToggleExpanded: () => void;
	onJump: (c: ReviewComment) => void;
	onToggleAddressed: (id: string) => void;
	onDelete: (id: string) => void;
	onClearAddressed: () => void;
	onToggleHideAddressed: () => void;
};

export function ReviewRailOverview({
	comments,
	hideAddressed,
	expanded,
	onToggleExpanded,
	onJump,
	onToggleAddressed,
	onDelete,
	onClearAddressed,
	onToggleHideAddressed,
}: Props) {
	const [showAll, setShowAll] = useState(false);
	const visible = filterHideAddressed(comments, hideAddressed);
	const grouped = groupCommentsByFile(visible);
	const openCount = comments.filter((c) => c.status === "open").length;
	const addressedCount = comments.length - openCount;

	const totalRows = grouped.reduce((sum, [, items]) => sum + items.length, 0);
	const isCapped = totalRows > MAX_OVERVIEW_ROWS && !showAll;

	let visibleGrouped = grouped;
	if (isCapped) {
		let remaining = MAX_OVERVIEW_ROWS;
		const capped: Array<[string, ReviewComment[]]> = [];
		for (const [filePath, items] of grouped) {
			if (remaining <= 0) break;
			if (items.length <= remaining) {
				capped.push([filePath, items]);
				remaining -= items.length;
			} else {
				capped.push([filePath, items.slice(0, remaining)]);
				remaining = 0;
			}
		}
		visibleGrouped = capped;
	}

	return (
		<section className="shell-review-overview" data-testid="review-overview">
			<button
				type="button"
				className="shell-review-overview__toggle"
				data-testid="review-overview-toggle"
				aria-expanded={expanded}
				onClick={onToggleExpanded}
			>
				<span>{expanded ? "▾" : "▸"} All open comments</span>
				<span className="shell-review-overview__count">{openCount}</span>
			</button>
			{expanded && (
				<>
					<div className="shell-review-overview__actions">
						<button type="button" onClick={onToggleHideAddressed}>
							{hideAddressed ? "Show addressed" : "Hide addressed"}
						</button>
						<button
							type="button"
							className="shell-review-overview__btn--danger"
							aria-label="Clear addressed"
							onClick={onClearAddressed}
							disabled={addressedCount === 0}
						>
							Clear addressed
						</button>
					</div>
					{grouped.length === 0 ? (
						<p className="shell-empty-state">No open comments.</p>
					) : (
						visibleGrouped.map(([filePath, items]) => (
							<div key={filePath} className="shell-review-overview__group">
								<div className="shell-review-overview__file">{filePath}</div>
								<ul>
									{items.map((cm) => (
										<li
											key={cm.id}
											className="shell-review-overview__row"
											data-status={cm.status}
										>
											<button
												type="button"
												className="shell-review-overview__row-jump"
												onClick={() => onJump(cm)}
											>
												<span>
													L{cm.startLine}
													{cm.startLine !== cm.endLine ? `–${cm.endLine}` : ""}
												</span>
												<span>{firstLine(cm.body)}</span>
											</button>
											<div className="shell-review-overview__row-actions">
												<button
													type="button"
													aria-label={cm.status === "open" ? "Address" : "Reopen"}
													onClick={() => onToggleAddressed(cm.id)}
												>
													{cm.status === "open" ? (
														<Icon name="check" />
													) : (
														<Icon name="refresh" fallback="↺" />
													)}
												</button>
												<button
													type="button"
													aria-label="Delete comment"
													onClick={() => onDelete(cm.id)}
												>
													<Icon name="close" fallback="×" />
												</button>
											</div>
										</li>
									))}
								</ul>
							</div>
						))
					)}
					{isCapped && (
						<button
							type="button"
							className="shell-review-overview__show-all"
							data-testid="review-overview-show-all"
							onClick={() => setShowAll(true)}
						>
							Show all ({totalRows})
						</button>
					)}
				</>
			)}
		</section>
	);
}
