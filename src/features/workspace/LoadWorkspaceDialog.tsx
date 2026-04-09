import * as Dialog from "@radix-ui/react-dialog";
import { RepositoryInput } from "../repository/RepositoryInput";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onLoadPath: (path: string) => Promise<void>;
};

export function LoadWorkspaceDialog({ open, onOpenChange, onLoadPath }: Props) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-modal-overlay" />
				<Dialog.Content className="shell-modal shell-modal--workspace-picker">
					<Dialog.Title>Load workspace</Dialog.Title>
					<p className="shell-modal__copy">
						Open another repository-scoped workspace without leaving current session view.
					</p>
					<RepositoryInput onLoadPath={onLoadPath} />
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
