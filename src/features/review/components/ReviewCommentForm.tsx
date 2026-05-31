import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";

type Props = {
	onSave: (body: string) => void;
	onCancel: () => void;
};

export function ReviewCommentForm({ onSave, onCancel }: Props) {
	const [body, setBody] = useState("");
	const trimmed = body.trim();
	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={(e) => {
				e.preventDefault();
				if (trimmed) onSave(trimmed);
			}}
		>
			<Textarea
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder="What should the agent change?"
				rows={3}
			/>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={!trimmed}>
					Save
				</Button>
			</div>
		</form>
	);
}
