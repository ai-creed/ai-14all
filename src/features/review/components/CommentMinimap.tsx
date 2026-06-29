import { useState } from "react";
import type { ReviewComment } from "../../../../shared/models/review-comment";
import type { ReviewProgress } from "../logic/review-progress";
import { clusterDots, type Dot } from "../logic/minimap-clusters";
import { firstLine } from "../logic/group-comments";

type Props = {
	comments: ReviewComment[];
	totalLines: number;
	progress: ReviewProgress;
	onJump: (c: ReviewComment) => void;
	onToggleAddressed: (id: string) => void;
};

const CLUSTER_THRESHOLD = 0.02;

export function CommentMinimap({
	comments,
	totalLines,
	progress,
	onJump,
	onToggleAddressed,
}: Props) {
	const [activeHeadId, setActiveHeadId] = useState<string | null>(null);
	const byId = new Map(comments.map((c) => [c.id, c]));
	const dots: Dot[] =
		totalLines > 0
			? comments.map((c) => ({
					id: c.id,
					status: c.status,
					position: Math.min(
						1,
						Math.max(0, (c.startLine - 1) / Math.max(1, totalLines - 1)),
					),
				}))
			: [];
	const clusters = clusterDots(dots, CLUSTER_THRESHOLD);
	const fillPct =
		progress.total > 0
			? Math.round((progress.reviewed / progress.total) * 1000) / 10
			: 0;

	return (
		<aside
			className="shell-review-minimap"
			data-testid="review-minimap"
			aria-label="Comment map and review progress"
		>
			<div className="shell-review-minimap__track">
				<div
					className="shell-review-minimap__fill"
					data-testid="minimap-progress-fill"
					style={{ height: `${fillPct}%`, background: "var(--success)" }}
				/>
				{clusters.map((cluster) => {
					const head = cluster.items[0]!;
					const isCluster = cluster.items.length > 1;
					const isActive = activeHeadId === head.id;
					// Resolve this cluster's dots back to full comments so the flyout
					// can list every clustered comment (spec §large-data).
					const clusterComments = cluster.items
						.map((it) => byId.get(it.id))
						.filter((c): c is ReviewComment => c !== undefined);
					return (
						// Dot + flyout share ONE hover region. onMouseLeave lives on the
						// WRAPPER, not the dot, and the flyout is a child of the wrapper —
						// so moving the pointer from the dot onto the flyout's Jump/Resolve
						// buttons stays inside the wrapper and does not dismiss the flyout.
						<div
							key={head.id}
							className="shell-review-minimap__dot-wrap"
							style={{ top: `${cluster.position * 100}%` }}
							onMouseLeave={() =>
								setActiveHeadId((id) => (id === head.id ? null : id))
							}
						>
							<button
								type="button"
								data-testid={`minimap-dot-${head.id}`}
								className="shell-review-minimap__dot"
								aria-haspopup="dialog"
								style={{
									background:
										head.status === "open"
											? "var(--warning)"
											: "var(--success)",
								}}
								onMouseEnter={() => setActiveHeadId(head.id)}
								onFocus={() => setActiveHeadId(head.id)}
								onClick={() => setActiveHeadId(head.id)}
							>
								{isCluster ? (
									<span className="shell-review-minimap__count">
										+{cluster.items.length}
									</span>
								) : null}
							</button>
							{/* Always rendered so pointer can travel from dot → flyout buttons
							    without the flyout unmounting mid-transition. aria-hidden keeps
							    the inactive flyout invisible to getByRole queries; production
							    CSS adds display:none for the same state. */}
							<div
								className="shell-review-minimap__flyout"
								role="dialog"
								aria-hidden={!isActive}
								aria-label="Comment preview"
							>
								{clusterComments.length > 1 ? (
									<div className="shell-review-minimap__flyout-clusterhead">
										{clusterComments.length} comments here
									</div>
								) : null}
								{clusterComments.map((cm) => (
									<div
										key={cm.id}
										className="shell-review-minimap__flyout-item"
									>
										<div className="shell-review-minimap__flyout-head">
											<span className="shell-review-minimap__flyout-author">
												you
											</span>
											<span className="shell-review-minimap__flyout-line">
												L{cm.startLine}
												{cm.startLine !== cm.endLine ? `–${cm.endLine}` : ""}
											</span>
										</div>
										{cm.snippet ? (
											<code className="shell-review-minimap__flyout-snippet">
												{firstLine(cm.snippet)}
											</code>
										) : null}
										<div className="shell-review-minimap__flyout-body">
											{firstLine(cm.body)}
										</div>
										<div className="shell-review-minimap__flyout-actions">
											<button type="button" onClick={() => onJump(cm)}>
												Jump
											</button>
											<button
												type="button"
												onClick={() => onToggleAddressed(cm.id)}
											>
												{cm.status === "open" ? "Resolve" : "Reopen"}
											</button>
										</div>
									</div>
								))}
							</div>
						</div>
					);
				})}
			</div>
		</aside>
	);
}
