import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { GitChange } from "../../../shared/models/git-change";
import type { FilesPaneMode } from "../../../shared/models/worktree-session";
import { WorktreeTree } from "../../features/viewer/components/WorktreeTree.js";
import { SymbolResults } from "../../features/code-nav/palette/SymbolResults.js";
import { useSymbolSearch } from "../../features/code-nav/palette/use-symbol-search.js";
import { useWorktreeStatus } from "../../features/code-nav/palette/use-worktree-status.js";
import { getActiveWorktreeRef } from "../../features/code-nav/nav/active-worktree-ref.js";
import { getNavRouter } from "../../features/code-nav/nav/router-singleton.js";
import { codeNavClient } from "../../features/code-nav/ipc/client.js";

export type FilesPaneProps = {
	workspaceId: string;
	worktreeId: string;
	worktreeLabel: string;
	selectedFile: string | null;
	onSelect: (relativePath: string) => void;
	onPreviewMarkdown?: (relativePath: string) => void;
	changedFiles: GitChange[];
	gitSummaryError?: boolean;
	gitSummaryMessage?: string | null;
	expandedPaths: string[];
	onExpandedPathsChange: (worktreeId: string, paths: string[]) => void;
	showIgnored: boolean;
	onToggleShowIgnored: () => void;
	mode: FilesPaneMode;
	onModeChange: (mode: FilesPaneMode) => void;
	onRequestClose: () => void;
};

export function FilesPane(props: FilesPaneProps) {
	const { mode, onModeChange, onRequestClose } = props;
	const ref = getActiveWorktreeRef();
	const ipcRef = ref
		? { workspaceId: ref.workspaceId, worktreeId: ref.worktreeId }
		: null;
	const symbolsActive = mode === "symbols";
	const activeRef = symbolsActive ? ipcRef : null;

	const [query, setQuery] = useState("");
	const [cursor, setCursor] = useState(0);
	const [refreshing, setRefreshing] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const status = useWorktreeStatus(activeRef);
	// Only hit the symbol-search IPC once the worktree is confirmed available.
	// For a worktree with no cortex mirror, status resolves to available:false and
	// every searchSymbols call would throw CortexIndexNotReadyError in the main
	// process; SymbolResults renders the unavailable banner from `status` instead.
	const searchRef = status?.available === true ? activeRef : null;
	const { results, loading, error } = useSymbolSearch(searchRef, query);

	// Focus the search input when entering Symbols mode (e.g. via Cmd+T). The
	// terminal's auto-focus is suppressed while the review overlay is open (see
	// TerminalPane `suppressAutoFocus`), so this focus is not clobbered.
	useEffect(() => {
		if (symbolsActive) inputRef.current?.focus();
	}, [symbolsActive]);

	function pick(i: number) {
		const row = results[i];
		if (!row || !ref) return;
		// Navigation lands in THIS overlay's editor pane, so do NOT close the
		// overlay — closing would hide the file the user just jumped to. Esc is the
		// only thing that closes the overlay from here.
		void getNavRouter()?.navigate({
			workspaceId: ref.workspaceId,
			worktreeId: ref.worktreeId,
			file: row.file,
			line: row.line,
			column: row.col ?? undefined,
			source: "palette",
		});
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

	function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (!symbolsActive) return;
		if (e.key === "ArrowDown")
			setCursor((c) => Math.min(c + 1, results.length - 1));
		else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
		else if (e.key === "Enter") pick(cursor);
		else if (e.key === "Escape") onRequestClose();
	}

	return (
		<div className="files-pane">
			<div className="files-pane__searchwrap">
				<input
					ref={inputRef}
					data-testid="symbol-search-input"
					className="files-pane__search shell-input"
					placeholder={symbolsActive ? "Search symbols…" : "Search files…"}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setCursor(0);
					}}
					onKeyDown={handleInputKeyDown}
					aria-label={symbolsActive ? "Search symbols" : "Search files"}
				/>
				<div
					className="files-pane__modes"
					role="group"
					aria-label="Search mode"
				>
					<button
						type="button"
						data-testid="files-pane-mode-files"
						className={
							"files-pane__mode-btn" + (!symbolsActive ? " is-active" : "")
						}
						aria-pressed={!symbolsActive}
						aria-label="Files"
						title="Search files"
						onClick={() => onModeChange("files")}
					>
						<Icon name="file" />
					</button>
					<button
						type="button"
						data-testid="files-pane-mode-symbols"
						className={
							"files-pane__mode-btn" + (symbolsActive ? " is-active" : "")
						}
						aria-pressed={symbolsActive}
						aria-label="Symbols"
						title="Search symbols"
						onClick={() => onModeChange("symbols")}
					>
						<Icon name="code" />
					</button>
				</div>
			</div>

			<div
				className="files-pane__body"
				data-testid="files-pane-body"
				hidden={symbolsActive}
				aria-hidden={symbolsActive}
			>
				<WorktreeTree
					workspaceId={props.workspaceId}
					worktreeId={props.worktreeId}
					worktreeLabel={props.worktreeLabel}
					searchTerm={symbolsActive ? "" : query}
					selectedFile={props.selectedFile}
					onSelect={props.onSelect}
					onPreviewMarkdown={props.onPreviewMarkdown}
					changedFiles={props.changedFiles}
					gitSummaryError={props.gitSummaryError}
					gitSummaryMessage={props.gitSummaryMessage}
					expandedPaths={props.expandedPaths}
					onExpandedPathsChange={props.onExpandedPathsChange}
					showIgnored={props.showIgnored}
					onToggleShowIgnored={props.onToggleShowIgnored}
				/>
			</div>

			{symbolsActive && (
				<SymbolResults
					status={status}
					results={results}
					loading={loading}
					error={error}
					cursor={cursor}
					query={query}
					refreshing={refreshing}
					onPick={pick}
					onRefresh={handleRefresh}
				/>
			)}
		</div>
	);
}
