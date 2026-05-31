import { useLayoutEffect } from "react";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";

type Props = {
	range: { startLine: number; endLine: number };
	body: string;
	onChange: (body: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
	onMeasureChange: () => void;
};

export function InlineDraftThread({
	range,
	body,
	onChange,
	onSubmit,
	onCancel,
	onMeasureChange,
}: Props) {
	useLayoutEffect(() => {
		onMeasureChange();
	}, [body, onMeasureChange]);

	return (
		<div className="border-l-2 border-[var(--pane-border-review)] bg-card p-3" data-state="editing" data-draft="true">
			<header className="flex items-center gap-2 text-xs text-muted-foreground">
				<span>
					New comment · L{range.startLine}
					{range.startLine !== range.endLine ? `–${range.endLine}` : ""}
				</span>
			</header>
			<Textarea
				autoFocus
				value={body}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Write a comment…"
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						if (body.trim().length > 0) onSubmit();
					}
				}}
			/>
			<div className="flex gap-2 mt-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					size="sm"
					disabled={body.trim().length === 0}
					onClick={onSubmit}
				>
					Save
				</Button>
			</div>
		</div>
	);
}
