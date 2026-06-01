import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Files, StickyNote, Pencil, Check } from "lucide-react";

type Props = {
	sessionTitle: string;
	worktreeLabel: string;
	branchName: string | null;
	isDirty: boolean;
	changedFileCount: number;
	noteNonEmpty: boolean;
	onRenameClick: () => void;
	onDirtyClick: () => void;
	onFilesClick: () => void;
	onNoteClick: () => void;
	/**
	 * Optional render slot for a separate right-side action group (e.g. terminal
	 * controls). Rendered after the Files/Note chips, separated by a divider.
	 * Kept presentational: SessionChipBar renders the node, it owns no
	 * terminal-specific logic.
	 */
	terminalActions?: React.ReactNode;
	/** Render slot for the token-telemetry strip, placed in the bar's mid gap. */
	usage?: React.ReactNode;
};

export function SessionChipBar({
	sessionTitle,
	worktreeLabel,
	branchName,
	isDirty,
	changedFileCount,
	noteNonEmpty,
	onRenameClick,
	onDirtyClick,
	onFilesClick,
	onNoteClick,
	terminalActions,
	usage,
}: Props) {
	return (
		<div className="relative flex items-center gap-3 h-10" role="region" aria-label="Session">
			{/* Left: session info */}
			<div className="flex items-center gap-2">
				<span className="font-semibold truncate">{sessionTitle}</span>
				<button
					type="button"
					className="opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
					aria-label="Rename session"
					onClick={onRenameClick}
				>
					<Pencil className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			</div>

			<div className="flex items-center gap-2 text-sm" aria-label="Worktree and branch">
				<span className="text-muted-foreground">{worktreeLabel}</span>
				{branchName && (
					<>
						<span className="w-px h-4 bg-border" aria-hidden="true" />
						<span className="text-muted-foreground">{branchName}</span>
					</>
				)}
			</div>

			<div>
				{isDirty ? (
					<Badge
						variant="outline"
						className="cursor-pointer bg-warning/20 text-warning border-warning/30 hover:bg-warning/30"
						aria-label={`${changedFileCount} changed files — open review`}
						onClick={onDirtyClick}
					>
						{changedFileCount} changed
					</Badge>
				) : (
					<span
						className="text-xs text-muted-foreground"
						title="Clean — no changes"
						aria-label="Clean"
					>
						<Check className="h-3 w-3 inline" aria-hidden="true" /> clean
					</span>
				)}
			</div>

			{/* Center: token telemetry */}
			{usage && (
				<div className="absolute left-1/2 -translate-x-1/2 pointer-events-auto">
					{usage}
				</div>
			)}

			{/* Right: actions */}
			<div className="ml-auto flex items-center gap-2">
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8"
					aria-label="Open Files"
					onClick={onFilesClick}
				>
					<Files className="h-4 w-4" aria-hidden="true" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 relative"
					data-indicator={noteNonEmpty ? "true" : "false"}
					aria-label="Open note"
					onClick={onNoteClick}
				>
					<StickyNote className="h-4 w-4" aria-hidden="true" />
					{noteNonEmpty && (
						<span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
					)}
				</Button>
				{terminalActions && (
					<>
						<span
							className="w-px h-4 bg-border"
							aria-hidden="true"
						/>
						{terminalActions}
					</>
				)}
			</div>
		</div>
	);
}
