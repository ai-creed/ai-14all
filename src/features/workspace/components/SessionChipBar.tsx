import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
	ArrowSquareOutIcon,
	CheckIcon,
	FilesIcon,
	NoteIcon,
	PencilSimpleIcon,
	QuestionIcon,
} from "@phosphor-icons/react";
import { HelpHint } from "../../../components/HelpHint";

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
	onShortcutsClick: () => void;
	onAboutClick: () => void;
	onPreferencesClick: () => void;
	onOpenExternalReadme: () => void;
	/**
	 * Optional render slot for a separate right-side action group (e.g. terminal
	 * controls). Rendered after the FilesIcon/NoteIcon chips, separated by a divider.
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
	onShortcutsClick,
	onAboutClick,
	onPreferencesClick,
	onOpenExternalReadme,
	terminalActions,
	usage,
}: Props) {
	return (
		<div
			className="shell-chip-bar"
			role="region"
			aria-label="Session"
			data-tour="chipbar"
		>
			<div className="shell-chip-bar__identity">
				<span className="shell-chip-bar__title">{sessionTitle}</span>
				<button
					type="button"
					className="shell-chip-bar__rename"
					aria-label="Rename session"
					onClick={onRenameClick}
				>
					<PencilSimpleIcon size={14} weight="regular" aria-hidden="true" />
				</button>
			</div>

			<div className="shell-chip-bar__meta" aria-label="Worktree and branch">
				<span className="shell-chip-bar__worktree">{worktreeLabel}</span>
				<HelpHint term="Worktree" side="bottom">
					A worktree is a checkout of a git branch in its own directory. Each
					session has its own worktree so its files and uncommitted changes
					stay isolated from other sessions.
				</HelpHint>
				{branchName && (
					<>
						<span className="shell-chip-bar__sep" aria-hidden="true">
							·
						</span>
						<span className="shell-chip-bar__branch">{branchName}</span>
					</>
				)}
			</div>

			<div className="shell-chip-bar__status">
				{isDirty ? (
					<button
						type="button"
						className="shell-chip-bar__dirty-chip"
						aria-label={`${changedFileCount} changed files — open review`}
						onClick={onDirtyClick}
					>
						{changedFileCount} changed
					</button>
				) : (
					<span
						className="shell-chip-bar__clean"
						title="Clean — no changes"
						aria-label="Clean"
					>
						<CheckIcon size={12} weight="regular" aria-hidden="true" /> clean
					</span>
				)}
			</div>

			{usage && <div className="shell-chip-bar__usage">{usage}</div>}

			<div className="shell-chip-bar__actions">
				<button
					type="button"
					className="shell-chip-bar__action"
					aria-label="Open FilesIcon"
					onClick={onFilesClick}
				>
					<span className="shell-chip-bar__action-icon" aria-hidden="true">
						<FilesIcon size={14} weight="regular" />
					</span>
					FilesIcon
				</button>
				<button
					type="button"
					className="shell-chip-bar__action"
					data-indicator={noteNonEmpty ? "true" : "false"}
					aria-label="Open note"
					onClick={onNoteClick}
				>
					<span className="shell-chip-bar__action-icon" aria-hidden="true">
						<NoteIcon size={14} weight="regular" />
					</span>
					NoteIcon
					{noteNonEmpty && (
						<span className="shell-chip-bar__note-dot" aria-hidden="true" />
					)}
				</button>
				{terminalActions && (
					<>
						<span
							className="shell-chip-bar__action-divider"
							aria-hidden="true"
						/>
						{terminalActions}
					</>
				)}
				<span
					className="shell-chip-bar__action-divider"
					aria-hidden="true"
				/>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger asChild>
						<button
							type="button"
							className="shell-chip-bar__action"
							aria-label="Help"
							title="Help"
						>
							<span
								className="shell-chip-bar__action-icon"
								aria-hidden="true"
							>
								<QuestionIcon size={14} weight="regular" />
							</span>
						</button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content className="shell-toolbar-menu" align="end">
							<DropdownMenu.Item
								className="shell-toolbar-menu__item"
								onSelect={onShortcutsClick}
							>
								Keyboard shortcuts
							</DropdownMenu.Item>
							<DropdownMenu.Item
								className="shell-toolbar-menu__item"
								onSelect={onAboutClick}
							>
								About ai-14all
							</DropdownMenu.Item>
							<DropdownMenu.Item
								className="shell-toolbar-menu__item"
								onSelect={onPreferencesClick}
							>
								Preferences…
							</DropdownMenu.Item>
							<DropdownMenu.Item
								className="shell-toolbar-menu__item"
								onSelect={onOpenExternalReadme}
							>
								Open README on GitHub
								<ArrowSquareOutIcon
									size={12}
									weight="regular"
									aria-hidden="true"
									style={{ marginLeft: 6, verticalAlign: "middle" }}
								/>
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</div>
		</div>
	);
}
