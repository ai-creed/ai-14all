import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogClose,
} from "@/components/ui/dialog";
import { SHORTCUT_REGISTRY, type Platform } from "../../app/shortcut-registry";

interface Props {
	open: boolean;
	platform: Platform;
	onClose: () => void;
	onRestartOnboarding?: () => void;
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
		ids: ["shortcuts-help"],
	},
];

export function ShortcutsHelp({ open, platform, onClose, onRestartOnboarding }: Props) {
	const byId = Object.fromEntries(SHORTCUT_REGISTRY.map((s) => [s.id, s]));

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<DialogContent
				className="w-[800px] max-w-[calc(100vw-32px)] p-0 shadow-[0_8px_32px_rgba(0,0,0,0.4)] outline-none"
				data-testid="shortcuts-help"
			>
				<div className="flex items-center justify-between px-4 py-3 border-b border-border">
					<DialogTitle className="text-foreground text-sm font-semibold m-0">
						Keyboard shortcuts
					</DialogTitle>
					<DialogClose asChild>
						<button
							type="button"
							className="bg-transparent border-none text-muted-foreground cursor-pointer p-1 text-xs leading-none rounded-sm hover:text-foreground"
							aria-label="Close shortcuts"
							data-testid="shortcuts-help-close"
						>
							✕
						</button>
					</DialogClose>
				</div>
				<div className="columns-2 gap-4 px-2 py-2 max-h-[calc(100vh-96px)] overflow-y-auto">
					{SHORTCUT_GROUPS.map((group) => {
						const shortcuts = group.ids.map((id) => byId[id]).filter(Boolean);
						if (!shortcuts.length) return null;
						return (
							<section
								key={group.label}
								className="break-inside-avoid"
							>
								<h3 className="ml-4">
									{group.label}
								</h3>
								<ul className="list-none m-0 py-2" role="list">
									{shortcuts.map((shortcut) => (
										<li
											key={shortcut.id}
											className="flex items-center justify-between px-4 py-2"
											data-testid={`shortcuts-help-row-${shortcut.id}`}
										>
											<span className="text-foreground text-xs">
												{shortcut.label}
											</span>
											<kbd className="text-muted-foreground text-xs font-sans bg-muted border border-border rounded-sm px-2 py-1">
												{platform === "mac" ? shortcut.mac : shortcut.other}
											</kbd>
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</div>
					{onRestartOnboarding && (
						<div className="px-4 py-3 border-t border-border">
							<button
								type="button"
								className="h-8 px-3 text-sm leading-8 text-foreground bg-card border border-border rounded-sm cursor-pointer hover:border-muted-foreground"
								onClick={() => {
									onRestartOnboarding();
									onClose();
								}}
							>
								Restart Onboarding
							</button>
						</div>
					)}
			</DialogContent>
		</Dialog>
	);
}
