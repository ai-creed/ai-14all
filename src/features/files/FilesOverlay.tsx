import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchFiles } from "../../../shared/files/match-files";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { GitChangeStatus } from "../../../shared/models/git-change";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

export interface FilesOverlayProps {
	isOpen: boolean;
	onClose: () => void;
	trackedFilesLoader: (opts: { includeIgnored: boolean }) => Promise<string[]>;
	gitStatusMap: Map<string, GitChangeStatus>;
	onOpenFile: (path: string) => void;
	/** Shared with the Files-tab tree — same session-state field. */
	showGitignored: boolean;
	onToggleShowGitignored: () => void;
}

const ROW_HEIGHT = 32;

function basenameOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

function dirnameOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

export function FilesOverlay(props: FilesOverlayProps) {
	const {
		isOpen,
		onClose,
		trackedFilesLoader,
		gitStatusMap,
		showGitignored,
		onToggleShowGitignored,
	} = props;
	const [tracked, setTracked] = useState<string[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const scrollParentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) {
			setTracked([]);
			setLoadError(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const paths = await trackedFilesLoader({
					includeIgnored: showGitignored,
				});
				if (!cancelled) {
					setTracked(paths);
					setLoadError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setLoadError(err instanceof Error ? err.message : String(err));
					setTracked([]);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isOpen, trackedFilesLoader, showGitignored]);

	const [query, setQuery] = useState("");

	useEffect(() => {
		if (!isOpen) setQuery("");
	}, [isOpen]);

	const filtered = useMemo(() => {
		if (tracked.length === 0) return [];
		return matchFiles(query, tracked).map((s) => s.path);
	}, [query, tracked]);

	const rows = filtered;

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollParentRef.current,
		estimateSize: () => ROW_HEIGHT,
		overscan: 10,
	});

	const [selectedIndex, setSelectedIndex] = useState(0);

	useEffect(() => {
		setSelectedIndex(0);
	}, [query, isOpen]);

	useEffect(() => {
		if (selectedIndex >= rows.length && rows.length > 0) {
			setSelectedIndex(rows.length - 1);
		}
	}, [rows.length, selectedIndex]);

	useEffect(() => {
		if (rows.length === 0) return;
		virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
	}, [selectedIndex, rows.length, virtualizer]);

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				className="fixed top-[10vh] left-1/2 -translate-x-1/2 translate-y-0 w-[min(680px,92vw)] max-h-[70vh] flex flex-col bg-background text-foreground border border-border rounded-lg shadow-[0_24px_48px_rgba(0,0,0,0.35)] overflow-hidden p-0"
				data-testid="files-overlay"
				aria-label="Files"
				onKeyDown={(e) => {
					if (rows.length === 0) return;
					if (e.key === "ArrowDown") {
						e.preventDefault();
						setSelectedIndex((i) => Math.min(rows.length - 1, i + 1));
						return;
					}
					if (e.key === "ArrowUp") {
						e.preventDefault();
						setSelectedIndex((i) => Math.max(0, i - 1));
						return;
					}
					if (e.key === "Home") {
						e.preventDefault();
						setSelectedIndex(0);
						return;
					}
					if (e.key === "End") {
						e.preventDefault();
						setSelectedIndex(rows.length - 1);
						return;
					}
					if (e.key === "Enter") {
						e.preventDefault();
						const path = rows[selectedIndex];
						if (path) props.onOpenFile(path);
						return;
					}
				}}
			>
				<DialogTitle className="px-4 py-3 text-xs font-semibold text-muted-foreground border-b border-border">
					Files
				</DialogTitle>
				<DialogDescription className="sr-only">
					Search and open files from the active session.
				</DialogDescription>
				<div className="flex-1 flex flex-col min-h-0">
					<div className="flex items-center justify-end gap-2 px-3 pt-2">
						<ToggleSwitch
							id="files-overlay-show-gitignored"
							checked={showGitignored}
							onChange={onToggleShowGitignored}
							label="Show gitignored"
							ariaLabel="Show gitignored files"
						/>
					</div>
					<input
						className="flex-none mx-4 my-3 px-3 py-2 text-sm bg-white/[0.04] border border-border rounded-md outline-none text-foreground"
						data-testid="files-overlay-search"
						placeholder="Search files"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						autoFocus
					/>
					{loadError ? (
						<div
							className="p-6 text-center text-sm text-muted-foreground"
							data-testid="files-overlay-error"
							role="alert"
						>
							Couldn't load files. {loadError}
						</div>
					) : tracked.length === 0 ? (
						<div className="p-6 text-center text-sm text-muted-foreground">
							No files in this worktree.
						</div>
					) : rows.length === 0 ? (
						<div className="p-6 text-center text-sm text-muted-foreground">
							No files match.
						</div>
					) : (
						<div
							ref={scrollParentRef}
							className="flex-1 min-h-0 overflow-auto"
							data-testid="files-overlay-list"
						>
							<div
								style={{
									position: "relative",
									height: virtualizer.getTotalSize(),
									width: "100%",
								}}
							>
								{virtualizer.getVirtualItems().map((virtualRow) => {
									const path = rows[virtualRow.index];
									const base = basenameOf(path);
									const dir = dirnameOf(path);
									const status = gitStatusMap.get(path);
									return (
										<div
											key={path}
											data-testid={`files-overlay-row-${path}`}
											data-selected={
												virtualRow.index === selectedIndex ? "true" : "false"
											}
											className={`flex items-center gap-2 px-4 text-sm cursor-pointer hover:bg-white/[0.04] ${
												virtualRow.index === selectedIndex
													? "bg-[rgba(77,163,255,0.16)]"
													: ""
											}`}
											onClick={() => props.onOpenFile(path)}
											style={{
												position: "absolute",
												top: 0,
												left: 0,
												width: "100%",
												height: ROW_HEIGHT,
												transform: `translateY(${virtualRow.start}px)`,
											}}
										>
											<span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis">
												{base}
											</span>
											{dir && (
												<span className="text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0">
													{dir}
												</span>
											)}
											{status && (
												<span
													className="ml-auto text-xs font-semibold min-w-[16px] text-right"
													data-testid={`files-overlay-row-status-${path}`}
												>
													{status}
												</span>
											)}
										</div>
									);
								})}
							</div>
						</div>
					)}
				</div>
				<div
					className="flex-none flex items-center gap-3 px-4 py-2 border-t border-border text-xs"
					data-testid="files-overlay-footer"
				>
					<span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
						{rows[selectedIndex] ?? ""}
					</span>
					<span className="flex gap-3 items-center">
						<span>
							<kbd className="px-2 py-1 border border-border rounded bg-white/[0.04] text-xs">
								↵
							</kbd>{" "}
							Open
						</span>
						<span>
							<kbd className="px-2 py-1 border border-border rounded bg-white/[0.04] text-xs">
								Esc
							</kbd>{" "}
							Close
						</span>
					</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}
