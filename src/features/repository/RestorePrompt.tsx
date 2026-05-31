import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
	repositoryPath: string;
	onDecide: (decision: {
		shouldRestore: boolean;
		rememberChoice: boolean;
	}) => void;
};

export function RestorePrompt({ repositoryPath, onDecide }: Props) {
	const [rememberChoice, setRememberChoice] = useState(false);

	return (
		<section className="flex flex-col items-center justify-center gap-4 p-8">
			<h1 className="text-2xl font-bold">ai-14all</h1>
			<h2>Restore previous workspace?</h2>
			<p className="text-sm text-muted-foreground italic">{repositoryPath}</p>
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={rememberChoice}
					onChange={(event) => setRememberChoice(event.target.checked)}
				/>
				Remember my choice
			</label>
			<div className="flex gap-2">
				<Button
					type="button"
					variant="outline"
					onClick={() => onDecide({ shouldRestore: true, rememberChoice })}
				>
					Restore previous workspace
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={() => onDecide({ shouldRestore: false, rememberChoice })}
				>
					Start clean
				</Button>
			</div>
		</section>
	);
}
