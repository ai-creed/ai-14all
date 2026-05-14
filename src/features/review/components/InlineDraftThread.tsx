import { useLayoutEffect } from "react";

type Props = {
	range: { startLine: number; endLine: number };
	body: string;
	onChange: (body: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
	onMeasureChange: () => void;
};

export function InlineDraftThread({ range, body, onChange, onSubmit, onCancel, onMeasureChange }: Props) {
	useLayoutEffect(() => {
		onMeasureChange();
	}, [body, onMeasureChange]);

	return (
		<div className="shell-inline-thread" data-state="editing" data-draft="true">
			<header className="shell-inline-thread__header">
				<span>
					New comment · L{range.startLine}
					{range.startLine !== range.endLine ? `–${range.endLine}` : ""}
				</span>
			</header>
			<textarea
				className="shell-inline-thread__textarea"
				autoFocus
				value={body}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Write a comment…"
			/>
			<div className="shell-inline-thread__actions">
				<button type="button" onClick={onCancel}>Cancel</button>
				<button
					type="button"
					disabled={body.trim().length === 0}
					onClick={onSubmit}
				>
					Save
				</button>
			</div>
		</div>
	);
}
