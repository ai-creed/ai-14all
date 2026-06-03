import type { Worktree } from "../../../../shared/models/worktree";

type Props = {
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	onSelect: (id: string) => void;
};

export function WorktreeList({
	worktrees,
	selectedWorktreeId,
	onSelect,
}: Props) {
	if (worktrees.length === 0) {
		return <p>No worktrees found.</p>;
	}

	return (
		<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
			{worktrees.map((wt) => {
				const isSelected = wt.id === selectedWorktreeId;
				return (
					<li
						key={wt.id}
						onClick={() => onSelect(wt.id)}
						style={{
							padding: "8px 12px",
							marginBottom: 4,
							cursor: "pointer",
							border: isSelected
								? "1px solid var(--border)"
								: "1px solid transparent",
							background: isSelected ? "var(--accent)" : "transparent",
						}}
					>
						<div>
							<strong>{wt.label}</strong>
						</div>
						<div style={{ fontSize: "0.9em", color: "var(--muted-foreground)" }}>
							Branch: {wt.branchName}
						</div>
						<div
							style={{
								fontSize: "0.85em",
								color: "var(--muted-foreground)",
								fontFamily: "monospace",
							}}
						>
							{wt.path}
						</div>
					</li>
				);
			})}
		</ul>
	);
}
