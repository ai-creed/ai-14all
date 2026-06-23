import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchFiles } from "../../../shared/files/match-files";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { GitChangeStatus } from "../../../shared/models/git-change";
import { Icon } from "@/components/ui/icon";
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

const ROW_HEIGHT = 28;

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
				className="shell-files-overlay"
				data-testid="files-overlay"
				aria-label="Files"
				hideClose
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
				<div className="shell-files-overlay__titlebar">
					<DialogTitle className="shell-files-overlay__title">
						Files
					</DialogTitle>
					<DialogClose
						className="shell-files-overlay__close"
						aria-label="Close files"
					>
						<Icon name="close" lucide={X} className="h-4 w-4" />
					</DialogClose>
				</div>
				<DialogDescription className="sr-only">
					Search and open files from the active session.
				</DialogDescription>
				<div className="shell-files-overlay__body">
					<div className="shell-files-overlay__toolbar">
						<ToggleSwitch
							id="files-overlay-show-gitignored"
							checked={showGitignored}
							onChange={onToggleShowGitignored}
							label="Show gitignored"
							ariaLabel="Show gitignored files"
						/>
					</div>
					<input
						className="shell-files-overlay__search"
						data-testid="files-overlay-search"
						placeholder="Search files"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						autoFocus
					/>
					{loadError ? (
						<div
							className="shell-files-overlay__empty"
							data-testid="files-overlay-error"
							role="alert"
						>
							Couldn't load files. {loadError}
						</div>
					) : tracked.length === 0 ? (
						<div className="shell-files-overlay__empty">
							No files in this worktree.
						</div>
					) : rows.length === 0 ? (
						<div className="shell-files-overlay__empty">No files match.</div>
					) : (
						<div
							ref={scrollParentRef}
							className="shell-files-overlay__list"
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
											className={
												"shell-files-overlay__row" +
												(virtualRow.index === selectedIndex
													? " shell-files-overlay__row--selected"
													: "")
											}
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
											<span
												className="shell-files-overlay__row-icon hidden tui:inline-flex"
												aria-hidden="true"
											>
												<Icon name="file" />
											</span>
											<span className="shell-files-overlay__row-basename">
												{base}
											</span>
											{dir && (
												<span className="shell-files-overlay__row-dir">
													{dir}
												</span>
											)}
											{status && (
												<span
													className="shell-files-overlay__row-status"
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
					className="shell-files-overlay__footer"
					data-testid="files-overlay-footer"
				>
					<span className="shell-files-overlay__footer-path">
						{rows[selectedIndex] ?? ""}
					</span>
					<span className="shell-files-overlay__footer-hints">
						<span>
							<kbd>↵</kbd> Open
						</span>
						<span>
							<kbd>Esc</kbd> Close
						</span>
					</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}
