import type { Worktree } from "../../../shared/models/worktree";

type Props = {
	worktrees: Worktree[];
	selectedWorktreeId: string | null;
	onSelect: (worktreeId: string) => void;
};

export function SessionSidebar({
	worktrees,
	selectedWorktreeId,
	onSelect,
}: Props) {
	return (
		<aside style={{ borderRight: "1px solid #d0d7de", padding: 12 }}>
			{worktrees.map((worktree) => {
				const selected = worktree.id === selectedWorktreeId;
				return (
					<button
						key={worktree.id}
						type="button"
						onClick={() => onSelect(worktree.id)}
						style={{
							display: "block",
							width: "100%",
							marginBottom: 8,
							padding: "10px 12px",
							textAlign: "left",
							border: selected ? "1px solid #1f6feb" : "1px solid #d0d7de",
							background: selected ? "#eaf2ff" : "#fff",
							borderRadius: 8,
						}}
					>
						<strong>{worktree.label}</strong>
						<div style={{ fontSize: 12, color: "#57606a" }}>
							{worktree.branchName}
						</div>
					</button>
				);
			})}
		</aside>
	);
}
