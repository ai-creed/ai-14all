import type { GitChange } from "../../../shared/models/git-change";

type Props = {
	changes: GitChange[];
	selectedPath: string | null;
	onSelect: (relativePath: string) => void;
};

export function ChangesList({ changes, selectedPath, onSelect }: Props) {
	if (changes.length === 0) {
		return <p style={{ color: "#57606a" }}>No changed files.</p>;
	}

	return (
		<div
			style={{
				border: "1px solid #d0d7de",
				borderRadius: 8,
				overflow: "hidden",
			}}
		>
			{changes.map((change) => (
				<button
					key={change.path}
					type="button"
					onClick={() => onSelect(change.path)}
					style={{
						display: "flex",
						width: "100%",
						justifyContent: "space-between",
						padding: "8px 10px",
						background: selectedPath === change.path ? "#eaf2ff" : "#fff",
						border: 0,
						borderBottom: "1px solid #d0d7de",
					}}
				>
					<span>{change.path}</span>
					<strong>{change.status}</strong>
				</button>
			))}
		</div>
	);
}
