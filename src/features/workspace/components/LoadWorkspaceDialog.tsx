import { useState } from "react";
import { AppDialog } from "../../../components/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
				<Label htmlFor="load-workspace-path">Repository path</Label>
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
				{error && <div className="text-sm text-destructive">{error}</div>}
			</AppDialog.Body>
			<AppDialog.Footer>
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
					type="button"
					size="sm"
					disabled={loading || !path.trim()}
					onClick={() => void handleLoad()}
				>
					{loading ? "Loading…" : "Load"}
				</Button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
