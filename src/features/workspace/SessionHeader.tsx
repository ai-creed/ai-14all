type Props = {
	title: string;
	branchName: string;
	changedFileCount: number;
};

export function SessionHeader({ title, branchName, changedFileCount }: Props) {
	return (
		<header style={{ padding: "16px 20px", borderBottom: "1px solid #d0d7de" }}>
			<h2 style={{ margin: 0 }}>{title}</h2>
			<div style={{ marginTop: 4, color: "#57606a", fontSize: 14 }}>
				Branch: <strong>{branchName}</strong> · Changes:{" "}
				<strong>{changedFileCount}</strong>
			</div>
		</header>
	);
}
