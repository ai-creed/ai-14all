import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** Presentational, un-positioned coachmark callout. */
export function CoachmarkCard({
	title,
	body,
	onDismiss,
}: {
	title: string;
	body: string;
	onDismiss: () => void;
}) {
	return (
		<div
			className={cn(
				"max-w-[36ch] border-2 bg-background p-[1ch] font-mono text-foreground shadow-none tui:rounded-none",
			)}
			data-testid="coachmark"
			role="note"
		>
			<div className="flex items-start justify-between gap-[1ch]">
				<span className="flex items-center gap-[1ch] text-sm font-semibold">
					<Icon name="info" />
					{title}
				</span>
				<button
					type="button"
					aria-label="Dismiss hint"
					className="text-xs"
					onClick={onDismiss}
					data-testid="coachmark-dismiss"
				>
					<Icon name="close" />
				</button>
			</div>
			<p className="mt-[0.5lh] text-xs text-muted-foreground">{body}</p>
		</div>
	);
}
