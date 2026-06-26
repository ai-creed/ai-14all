import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { SHORTCUT_REGISTRY, type Platform } from "../../app/shortcut-registry";

interface Props {
	open: boolean;
	platform: Platform;
	onClose: () => void;
}

const SHORTCUT_GROUPS: { label: string; ids: string[] }[] = [
	{
		label: "Worktree",
		ids: ["worktree.selectNext", "worktree.selectPrev", "worktree.add"],
	},
	{
		label: "Workspace",
		ids: [
			"workspace.selectNext",
			"workspace.selectPrev",
			"ui.openWorkspacePicker",
		],
	},
	{
		label: "Terminal",
		ids: [
			"terminal.new",
			"terminal.newFloating",
			"terminal.close",
			"terminal.selectNext",
			"terminal.selectPrev",
			"terminal.layout",
		],
	},
	{
		label: "Layout",
		ids: ["layout.toggleSidebar"],
	},
	{
		label: "Review",
		ids: [
			"review.open",
			"review.files",
			"review.changes",
			"review.commits",
			"review.fileNext",
			"review.filePrev",
			"review.diffNext",
			"review.diffPrev",
			"files-overlay",
		],
	},
	{
		label: "Session",
		ids: ["note-sheet", "rename-session"],
	},
	{
		label: "App",
		ids: ["command-palette", "shortcuts-help"],
	},
];

export function ShortcutsHelp({ open, platform, onClose }: Props) {
	const byId = Object.fromEntries(SHORTCUT_REGISTRY.map((s) => [s.id, s]));

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<DialogContent
				className="shell-shortcuts-help"
				data-testid="shortcuts-help"
				hideClose
			>
				<div className="shell-shortcuts-help__header">
					<DialogTitle className="shell-shortcuts-help__title">
						Keyboard shortcuts
					</DialogTitle>
					<DialogClose asChild>
						<button
							type="button"
							className="shell-shortcuts-help__close"
							aria-label="Close shortcuts"
							data-testid="shortcuts-help-close"
						>
							<Icon name="close" />
						</button>
					</DialogClose>
				</div>
				<div className="shell-shortcuts-help__body">
					{SHORTCUT_GROUPS.map((group) => {
						const shortcuts = group.ids.map((id) => byId[id]).filter(Boolean);
						if (!shortcuts.length) return null;
						return (
							<section
								key={group.label}
								className="shell-shortcuts-help__group"
							>
								<h3 className="shell-shortcuts-help__group-label">
									{group.label}
								</h3>
								<ul className="shell-shortcuts-help__list" role="list">
									{shortcuts.map((shortcut) => (
										<li
											key={shortcut.id}
											className="shell-shortcuts-help__row"
											data-testid={`shortcuts-help-row-${shortcut.id}`}
										>
											<span className="shell-shortcuts-help__label">
												{shortcut.label}
											</span>
											<kbd className="shell-shortcuts-help__keys">
												{platform === "mac" ? shortcut.mac : shortcut.other}
											</kbd>
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
}
