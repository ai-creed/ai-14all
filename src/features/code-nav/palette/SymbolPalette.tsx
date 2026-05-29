import { useState } from "react";
import {
	AppDialog,
	Body as DialogBody,
	Title as DialogTitle,
} from "../../../components/AppDialog.js";
import { codeNavClient } from "../ipc/client.js";
import { navRouter } from "../monaco/register.js";
import { getActiveWorktreeRef } from "../nav/active-worktree-ref.js";
import { useSymbolSearch } from "./use-symbol-search.js";
import { useWorktreeStatus } from "./use-worktree-status.js";

export function SymbolPalette({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const ref = getActiveWorktreeRef();
	const ipcRef = ref
		? { workspaceId: ref.workspaceId, worktreeId: ref.worktreeId }
		: null;
	const [query, setQuery] = useState("");
	const [cursor, setCursor] = useState(0);
	const [refreshing, setRefreshing] = useState(false);
	const { results, loading, error } = useSymbolSearch(ipcRef, query);
	const status = useWorktreeStatus(ipcRef);

	function pick(i: number) {
		const row = results[i];
		if (!row || !ref) return;
		void navRouter?.navigate({
			workspaceId: ref.workspaceId,
			worktreeId: ref.worktreeId,
			file: row.file,
			line: row.line,
			source: "palette",
		});
		onClose();
	}

	async function handleRefresh() {
		if (!ipcRef) return;
		setRefreshing(true);
		try {
			await codeNavClient.refreshWorktree(ipcRef);
		} finally {
			setRefreshing(false);
		}
	}

	return (
		<AppDialog open={open} onOpenChange={(v) => !v && onClose()}>
			<DialogTitle>Go to symbol</DialogTitle>
			<DialogBody>
				{status?.dirtyAtIndex && (
					<div
						role="status"
						data-testid="stale-index-banner"
						className="code-nav-stale-banner"
					>
						<span>Index reflects HEAD, not working tree.</span>
						<button
							type="button"
							onClick={handleRefresh}
							disabled={refreshing}
						>
							{refreshing ? "Refreshing…" : "Refresh index"}
						</button>
					</div>
				)}
				<input
					autoFocus
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setCursor(0);
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown")
							setCursor((c) => Math.min(c + 1, results.length - 1));
						else if (e.key === "ArrowUp")
							setCursor((c) => Math.max(c - 1, 0));
						else if (e.key === "Enter") pick(cursor);
						else if (e.key === "Escape") onClose();
					}}
				/>
				{loading && <p>Searching…</p>}
				{error && <p role="alert">{error}</p>}
				<ul role="listbox">
					{results.map((r, i) => (
						<li
							key={r.id}
							role="option"
							aria-selected={i === cursor}
							onClick={() => pick(i)}
						>
							<span
								aria-label={
									r.qualified_name.includes(".") ? "method" : "function"
								}
							>
								{r.qualified_name.includes(".") ? "⊕" : "ƒ"}
							</span>
							<span>{r.qualified_name}</span>
							<span>
								{r.file}:{r.line}
							</span>
							{r.exported ? <span>exported</span> : null}
							{r.is_default ? <span>default</span> : null}
						</li>
					))}
				</ul>
			</DialogBody>
		</AppDialog>
	);
}
