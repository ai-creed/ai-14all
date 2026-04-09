import { useState } from "react";
import { repository } from "../../lib/desktop-client";
import { describeRepositoryLoadError } from "./describe-repository-load-error";

type Props = {
	onLoadPath: (path: string) => Promise<void>;
};

export function RepositoryInput({ onLoadPath }: Props) {
	const [path, setPath] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleBrowse() {
		if (loading) return;

		setError(null);
		try {
			const selectedPath = await repository.pickRoot();
			if (selectedPath) {
				setPath(selectedPath);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!path.trim()) return;

		setLoading(true);
		setError(null);

		try {
			await onLoadPath(path.trim());
		} catch (err) {
			setError(describeRepositoryLoadError(err));
		} finally {
			setLoading(false);
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<div>
				<label htmlFor="repo-path">Repository path</label>
			</div>
			<div style={{ marginTop: 4 }}>
				<input
					id="repo-path"
					type="text"
					value={path}
					onChange={(e) => setPath(e.target.value)}
					placeholder="/path/to/repo"
					disabled={loading}
					style={{ width: 400 }}
				/>
				<button
					type="button"
					disabled={loading}
					style={{ marginLeft: 8 }}
					onClick={handleBrowse}
				>
					Browse
				</button>
				<button
					type="submit"
					disabled={loading || !path.trim()}
					style={{ marginLeft: 8 }}
				>
					{loading ? "Loading…" : "Load"}
				</button>
			</div>
			{error && (
				<div style={{ marginTop: 8, color: "red" }}>Error: {error}</div>
			)}
		</form>
	);
}
