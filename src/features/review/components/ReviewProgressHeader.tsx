type Props = { reviewed: number; total: number };

export function ReviewProgressHeader({ reviewed, total }: Props) {
	if (total === 0) return null;
	const pct = Math.round((reviewed / total) * 1000) / 10;
	return (
		<div className="shell-review-progress" data-testid="review-progress-header">
			<span className="shell-review-progress__label">
				{reviewed} / {total} reviewed
			</span>
			<div className="shell-review-progress__track">
				<div
					className="shell-review-progress__fill"
					data-testid="review-progress-fill"
					style={{ width: `${pct}%`, background: "var(--success)" }}
				/>
			</div>
		</div>
	);
}
