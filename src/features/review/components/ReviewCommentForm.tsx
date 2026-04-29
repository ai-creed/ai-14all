import { useState } from "react";

type Props = {
	onSave: (body: string) => void;
	onCancel: () => void;
};

export function ReviewCommentForm({ onSave, onCancel }: Props) {
	const [body, setBody] = useState("");
	const trimmed = body.trim();
	return (
		<form
			className="shell-review-comment-form"
			onSubmit={(e) => {
				e.preventDefault();
				if (trimmed) onSave(trimmed);
			}}
		>
			<textarea
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder="What should the agent change?"
				rows={3}
			/>
			<div className="shell-review-comment-form__actions">
				<button type="button" onClick={onCancel}>
					Cancel
				</button>
				<button type="submit" disabled={!trimmed}>
					Save
				</button>
			</div>
		</form>
	);
}
