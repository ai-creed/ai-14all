import { AppDialog } from "../../components/AppDialog";
import { RepositoryInput } from "../repository/RepositoryInput";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onLoadPath: (path: string) => Promise<void>;
};

export function LoadWorkspaceDialog({ open, onOpenChange, onLoadPath }: Props) {
	return (
		<AppDialog open={open} onOpenChange={onOpenChange} size="wide">
			<AppDialog.Title>Load workspace</AppDialog.Title>
			<AppDialog.Description>
				Open a workspace by entering its path or browsing for it.
			</AppDialog.Description>
			<AppDialog.Body>
				<RepositoryInput onLoadPath={onLoadPath} />
			</AppDialog.Body>
			<AppDialog.Footer>
				<button
					type="button"
					className="shell-button shell-button--compact"
					onClick={() => onOpenChange(false)}
				>
					Close
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
