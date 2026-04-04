type Props = {
	title: string;
	branchName: string;
	changedFileCount: number;
	isDirty: boolean;
};

export function SessionHeader({
	title,
	branchName,
	changedFileCount,
	isDirty,
}: Props) {
	return (
		<header className="shell-panel shell-header">
			<div>
				<div className="shell-label">Active session</div>
				<h2 className="shell-header__title">{title}</h2>
			</div>
			<div className="shell-header__meta">
				<span>
					<span>Branch:</span> <strong>{branchName}</strong>
				</span>
				<span>
					<span>Status:</span> <strong>{isDirty ? "Dirty" : "Clean"}</strong>
				</span>
				<span>
					<span>Changes:</span> <strong>{changedFileCount}</strong>
				</span>
			</div>
		</header>
	);
}
