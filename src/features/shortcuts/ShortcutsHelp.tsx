import * as Dialog from "@radix-ui/react-dialog";
import { SHORTCUT_REGISTRY, type Platform } from "../../app/shortcut-registry";

interface Props {
	open: boolean;
	platform: Platform;
	onClose: () => void;
}

export function ShortcutsHelp({ open, platform, onClose }: Props) {
	return (
		<Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-shortcuts-help__overlay" />
				<Dialog.Content
					className="shell-shortcuts-help"
					data-testid="shortcuts-help"
					aria-label="Keyboard shortcuts"
				>
					<div className="shell-shortcuts-help__header">
						<Dialog.Title className="shell-shortcuts-help__title">
							Keyboard shortcuts
						</Dialog.Title>
						<Dialog.Close asChild>
							<button
								type="button"
								className="shell-shortcuts-help__close"
								aria-label="Close shortcuts"
							>
								✕
							</button>
						</Dialog.Close>
					</div>
					<ul className="shell-shortcuts-help__list" role="list">
						{SHORTCUT_REGISTRY.map((shortcut) => (
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
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
