import { cn } from "@/lib/utils";
import type { TourStep } from "../logic/tour-steps";

/** Presentational step card. No positioning — the overlay places it. */
export function TourStepCard({
	step,
	index,
	total,
	onNext,
	onBack,
	onSkip,
}: {
	step: TourStep;
	index: number;
	total: number;
	onNext: () => void;
	onBack: () => void;
	onSkip: () => void;
}) {
	const isFirst = index === 0;
	const isLast = index === total - 1;
	return (
		<div
			className={cn(
				"max-w-[42ch] border-2 bg-background p-[1ch] font-mono text-foreground shadow-none tui:rounded-none",
			)}
			data-testid="tour-card"
		>
			<span className="text-xs uppercase tracking-wide text-muted-foreground">
				{`Step ${index + 1} of ${total}`}
			</span>
			<h2 className="mt-[0.25lh] text-sm font-semibold">{step.title}</h2>
			<p className="mt-[0.5lh] text-xs text-muted-foreground">{step.body}</p>
			<div className="mt-[1lh] flex items-center justify-between gap-[1ch]">
				<button
					type="button"
					className="text-xs underline"
					onClick={onSkip}
					data-testid="tour-skip"
				>
					Skip
				</button>
				<div className="flex gap-[1ch]">
					{!isFirst && (
						<button
							type="button"
							className="border px-[1ch] text-xs tui:rounded-none"
							onClick={onBack}
							data-testid="tour-back"
						>
							Back
						</button>
					)}
					<button
						type="button"
						className="border px-[1ch] text-xs tui:rounded-none"
						onClick={onNext}
						data-testid="tour-next"
					>
						{isLast ? "Done" : "Next"}
					</button>
				</div>
			</div>
		</div>
	);
}
