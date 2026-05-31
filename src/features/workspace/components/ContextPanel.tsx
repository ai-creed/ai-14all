import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
	note: string;
	onNoteChange: (note: string) => void;
};

export function ContextPanel({ note, onNoteChange }: Props) {
	return (
		<aside aria-label="Session note panel" className="min-w-0 pl-4 border-l border-border">
			<Label htmlFor="session-note">
				Session note
			</Label>
			<Textarea
				id="session-note"
				value={note}
				onChange={(event) => onNoteChange(event.target.value)}
				rows={6}
			/>
		</aside>
	);
}
