import { useState } from "react";
import { Input } from "@/components/ui/input";
import { AppDialog } from "../../../components/AppDialog";
import { repository } from "../../../lib/desktop-client";
import { describeRepositoryLoadError } from "../../repository/describe-repository-load-error";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onLoadPath: (path: string) => Promise<void>;
};

export function LoadWorkspaceDialog({ open, onOpenChange, onLoadPath }: Props) {
	const [path, setPath] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleBrowse() {
		if (loading) return;
		setError(null);
		try {
			const selected = await repository.pickRoot();
			if (selected) setPath(selected);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleLoad() {
		if (!path.trim() || loading) return;
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
		<AppDialog open={open} onOpenChange={onOpenChange} size="wide">
			<AppDialog.Title>Load workspace</AppDialog.Title>
			<AppDialog.Description>
				Open a workspace by entering its path or browsing for it.
			</AppDialog.Description>
			<AppDialog.Body>
				<label htmlFor="load-workspace-path">Repository path</label>
				<Input
					id="load-workspace-path"
					type="text"
					value={path}
					onChange={(e) => setPath(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") void handleLoad();
					}}
					placeholder="/path/to/repo"
					disabled={loading}
					autoFocus
				/>
				{error && <div className="shell-error">{error}</div>}
			</AppDialog.Body>
			<AppDialog.Footer>
				<button
					type="button"
					className="shell-button shell-button--compact"
					disabled={loading}
					onClick={handleBrowse}
				>
					Browse
				</button>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--primary"
					disabled={loading || !path.trim()}
					onClick={() => void handleLoad()}
				>
					{loading ? "Loading…" : "Load"}
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
