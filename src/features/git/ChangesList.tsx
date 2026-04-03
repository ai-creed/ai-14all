import type { GitChange } from "../../../shared/models/git-change";

type Props = {
	changes: GitChange[];
	selectedPath: string | null;
	onSelect: (relativePath: string) => void;
};

export function ChangesList({ changes, selectedPath, onSelect }: Props) {
	if (changes.length === 0) {
		return <p className="shell-empty-state">No changed files.</p>;
	}

	return (
		<div className="shell-list">
			{changes.map((change) => (
				<button
					key={change.path}
					type="button"
					className="shell-list__item shell-list__item--split"
					data-selected={String(selectedPath === change.path)}
					onClick={() => onSelect(change.path)}
				>
					<span>{change.path}</span>
					<strong>{change.status}</strong>
				</button>
			))}
		</div>
	);
}
