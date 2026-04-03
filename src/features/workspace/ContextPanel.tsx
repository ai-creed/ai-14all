type Props = {
	branchName: string;
	worktreePath: string;
	note: string;
	onNoteChange: (note: string) => void;
};

export function ContextPanel({
	branchName,
	worktreePath,
	note,
	onNoteChange,
}: Props) {
	return (
		<aside
			style={{
				borderLeft: "1px solid #d0d7de",
				padding: 16,
				background: "#f6f8fa",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<div
					style={{ fontSize: 12, textTransform: "uppercase", color: "#57606a" }}
				>
					Active branch
				</div>
				<div
					style={{
						marginTop: 6,
						padding: "8px 10px",
						borderRadius: 8,
						background: "#1f6feb",
						color: "#fff",
						fontWeight: 700,
					}}
				>
					{branchName}
				</div>
			</div>

			<div style={{ marginBottom: 16 }}>
				<div
					style={{ fontSize: 12, textTransform: "uppercase", color: "#57606a" }}
				>
					Worktree path
				</div>
				<code
					style={{ display: "block", marginTop: 6, whiteSpace: "pre-wrap" }}
				>
					{worktreePath}
				</code>
			</div>

			<label
				htmlFor="session-note"
				style={{
					display: "block",
					fontSize: 12,
					textTransform: "uppercase",
					color: "#57606a",
				}}
			>
				Session note
			</label>
			<textarea
				id="session-note"
				value={note}
				onChange={(event) => onNoteChange(event.target.value)}
				rows={6}
				style={{ width: "100%", marginTop: 6, resize: "vertical" }}
			/>
		</aside>
	);
}
