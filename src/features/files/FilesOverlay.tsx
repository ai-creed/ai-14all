import * as Dialog from "@radix-ui/react-dialog";
import type { GitChangeStatus } from "../../../shared/models/git-change";

export interface FilesOverlayProps {
	isOpen: boolean;
	onClose: () => void;
	trackedFilesLoader: () => Promise<string[]>;
	gitStatusMap: Map<string, GitChangeStatus>;
	onViewFile: (path: string) => void;
	onEditFile: (path: string) => void;
	isEditable: (basename: string) => boolean;
}

export function FilesOverlay(props: FilesOverlayProps) {
	const { isOpen, onClose } = props;

	return (
		<Dialog.Root
			open={isOpen}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-files-overlay__backdrop" />
				<Dialog.Content
					className="shell-files-overlay"
					data-testid="files-overlay"
					aria-label="Files"
				>
					<Dialog.Title className="shell-files-overlay__title">Files</Dialog.Title>
					<Dialog.Description className="sr-only">
						Search and open files from the active session.
					</Dialog.Description>
					<div className="shell-files-overlay__body" data-testid="files-overlay-body">
						{/* search, list, footer land in later tasks */}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
