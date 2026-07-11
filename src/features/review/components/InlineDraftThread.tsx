import { useLayoutEffect, useState } from "react";

type Props = {
	range: { startLine: number; endLine: number };
	body: string;
	onChange: (body: string) => void;
	onSubmit: () => Promise<void> | void;
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
	const [submitting, setSubmitting] = useState(false);

	useLayoutEffect(() => {
		onMeasureChange();
	}, [body, onMeasureChange]);

	const submit = async () => {
		if (submitting || body.trim().length === 0) return;
		setSubmitting(true);
		try {
			await onSubmit();
		} finally {
			setSubmitting(false);
		}
	};

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
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						void submit();
					}
				}}
			/>
			<div className="shell-inline-thread__actions">
				<button type="button" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					disabled={submitting || body.trim().length === 0}
					onClick={() => void submit()}
				>
					Save
				</button>
			</div>
		</div>
	);
}
