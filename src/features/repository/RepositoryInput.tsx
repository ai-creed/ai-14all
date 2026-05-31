import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
				<Label htmlFor="repo-path">Repository path</Label>
			</div>
			<div className="flex gap-2 items-center">
				<Input
					id="repo-path"
					type="text"
					value={path}
					onChange={(e) => setPath(e.target.value)}
					placeholder="/path/to/repo"
					disabled={loading}
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={loading}
					onClick={handleBrowse}
				>
					Browse
				</Button>
				<Button
					type="submit"
					size="sm"
					disabled={loading || !path.trim()}
				>
					{loading ? "Loading…" : "Load"}
				</Button>
			</div>
			{error && <div className="text-sm text-destructive">Error: {error}</div>}
		</form>
	);
}
