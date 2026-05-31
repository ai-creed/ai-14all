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
	const [errorKind, setErrorKind] = useState<"not-found" | "not-git" | null>(
		null,
	);

	async function handleBrowse() {
		if (loading) return;

		setError(null);
		setErrorKind(null);
		try {
			const selectedPath = await repository.pickRoot();
			if (selectedPath) {
				setPath(selectedPath);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setErrorKind(null);
		}
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!path.trim()) return;

		setLoading(true);
		setError(null);
		setErrorKind(null);

		try {
			await onLoadPath(path.trim());
		} catch (err) {
			const message = describeRepositoryLoadError(err);
			setError(message);
			if (message === "Path does not exist.") setErrorKind("not-found");
			else if (message === "Path is not a Git repository.")
				setErrorKind("not-git");
			else setErrorKind(null);
		} finally {
			setLoading(false);
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<div>
				<label htmlFor="repo-path">Repository path</label>
			</div>
			<div className="shell-input-row">
				<input
					id="repo-path"
					type="text"
					className="shell-input"
					value={path}
					onChange={(e) => setPath(e.target.value)}
					placeholder="/path/to/repo"
					disabled={loading}
				/>
				<button
					type="button"
					className="shell-button shell-button--compact"
					disabled={loading}
					onClick={handleBrowse}
				>
					Browse
				</button>
				<button
					type="submit"
					className="shell-button shell-button--compact shell-button--primary"
					disabled={loading || !path.trim()}
				>
					{loading ? "Loading…" : "Load"}
				</button>
			</div>
			{error && (
				<div className="shell-error shell-input-row__error" role="alert">
					<span>{error}</span>
					{errorKind === "not-found" && (
						<button
							type="button"
							className="shell-link-button"
							onClick={handleBrowse}
						>
							Browse for a folder…
						</button>
					)}
					{errorKind === "not-git" && (
						<span className="shell-input-row__hint">
							Run <code>git init</code> in the folder, or browse another.
						</span>
					)}
				</div>
			)}
		</form>
	);
}
