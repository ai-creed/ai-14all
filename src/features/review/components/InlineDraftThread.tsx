import { useLayoutEffect, useState } from "react";

type Props = {
	range: { startLine: number; endLine: number };
	onSubmit: (body: string) => void;
	onCancel: () => void;
	onMeasureChange: () => void;
};

export function InlineDraftThread({ range, onSubmit, onCancel, onMeasureChange }: Props) {
	const [draft, setDraft] = useState("");

	useLayoutEffect(() => {
		onMeasureChange();
	}, [draft, onMeasureChange]);

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
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				placeholder="Write a comment…"
			/>
			<div className="shell-inline-thread__actions">
				<button type="button" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					disabled={draft.trim().length === 0}
					onClick={() => onSubmit(draft.trim())}
				>
					Save
				</button>
			</div>
		</div>
	);
}
