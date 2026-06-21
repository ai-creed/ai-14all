import { useEffect, useState } from "react";
import { repository as repositoryClient } from "../../lib/desktop-client";

type Options = {
	open: boolean;
	workspaceId: string | null;
};

export type BaseBranchOptionsState = {
	branches: string[];
	selected: string | null;
	setSelected: (branch: string) => void;
	loading: boolean;
	warning: string | null;
};

const REFRESH_WARNING =
	"Couldn't refresh from origin — showing last-fetched branches.";

/**
 * On dialog open, fetch from origin (non-blocking) then load the remote branch
 * list and pre-select the resolved default. A fetch failure surfaces a warning
 * but never blocks: cached `origin/*` refs are still listed. Resets when the
 * dialog closes so the default is re-applied on every open (no remembered base).
 *
 * The selection is only ever a real `origin/*` branch. When the repo has no
 * remote branches the service resolver returns the `"HEAD"` local-fallback
 * sentinel, which is NOT a selectable option — in that case the selection stays
 * empty so the create path omits `baseBranch` and the service default-resolves
 * to local `HEAD` (with a preview note), rather than passing `"HEAD"` as an
 * explicit base (which `resolveBaseRef` would reject as not an `origin/*` ref).
 */
export function useBaseBranchOptions(options: Options): BaseBranchOptionsState {
	const { open, workspaceId } = options;
	const [branches, setBranches] = useState<string[]>([]);
	const [selected, setSelected] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [warning, setWarning] = useState<string | null>(null);

	useEffect(() => {
		if (!open || !workspaceId) {
			setBranches([]);
			setSelected(null);
			setWarning(null);
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setWarning(null);
		void (async () => {
			const refresh = await repositoryClient.refreshRemote(workspaceId);
			if (cancelled) return;
			if (!refresh.ok) setWarning(REFRESH_WARNING);
			try {
				const result = await repositoryClient.listRemoteBranches(workspaceId);
				if (cancelled) return;
				setBranches(result.branches);
				// Pre-select the default ONLY when it is a real listed branch. The
				// "HEAD" local-fallback sentinel (no remote branches) is not selectable;
				// leaving the selection null makes the create path omit baseBranch so the
				// service falls back to local HEAD instead of validating "HEAD" as origin/*.
				setSelected(
					result.branches.includes(result.defaultBranch)
						? result.defaultBranch
						: null,
				);
			} catch (err) {
				if (cancelled) return;
				setWarning(
					(prev) => prev ?? (err instanceof Error ? err.message : String(err)),
				);
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [open, workspaceId]);

	return { branches, selected, setSelected, loading, warning };
}
