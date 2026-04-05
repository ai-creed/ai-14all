import { useState } from "react";

type Props = {
	repositoryPath: string;
	onDecide: (decision: { shouldRestore: boolean; rememberChoice: boolean }) => void;
};

export function RestorePrompt({ repositoryPath, onDecide }: Props) {
	const [rememberChoice, setRememberChoice] = useState(false);

	return (
		<section className="shell-panel shell-setup-panel">
			<h1 className="shell-setup-title">ai-14all</h1>
			<h2>Restore previous workspace?</h2>
			<p className="shell-empty-state">{repositoryPath}</p>
			<label className="shell-restore-checkbox">
				<input
					type="checkbox"
					checked={rememberChoice}
					onChange={(event) => setRememberChoice(event.target.checked)}
				/>
				Remember my choice
			</label>
			<div className="shell-restore-actions">
				<button
					type="button"
					className="shell-button"
					onClick={() => onDecide({ shouldRestore: true, rememberChoice })}
				>
					Restore previous workspace
				</button>
				<button
					type="button"
					className="shell-button"
					onClick={() => onDecide({ shouldRestore: false, rememberChoice })}
				>
					Start clean
				</button>
			</div>
		</section>
	);
}
