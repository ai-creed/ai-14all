import { useState, useEffect } from "react";
import { files } from "../../lib/desktop-client";

interface FileListProps {
	worktreePath: string;
	selectedFile: string | null;
	onSelect: (relativePath: string) => void;
}

export function FileList({
	worktreePath,
	selectedFile,
	onSelect,
}: FileListProps) {
	const [fileList, setFileList] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!worktreePath) return;
		setLoading(true);
		setError(null);
		files
			.list(worktreePath)
			.then((list) => {
				setFileList(list);
				setLoading(false);
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : String(err));
				setLoading(false);
			});
	}, [worktreePath]);

	if (loading) return <p className="shell-empty-state">Loading files…</p>;
	if (error) return <p className="shell-error">Error: {error}</p>;
	if (fileList.length === 0)
		return <p className="shell-empty-state">No files found.</p>;

	return (
		<div className="shell-list">
			{fileList.map((relativePath) => (
				<button
					key={relativePath}
					type="button"
					className="shell-list__item"
					data-selected={String(selectedFile === relativePath)}
					onClick={() => onSelect(relativePath)}
				>
					{relativePath}
				</button>
			))}
		</div>
	);
}
