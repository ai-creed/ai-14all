import * as Dialog from "@radix-ui/react-dialog";
import { PhoneBridgePanel } from "./PhoneBridgePanel";

export function PhoneBridgeDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): React.ReactElement {
	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="plugins-panel__overlay" />
				<Dialog.Content
					className="plugins-panel"
					data-testid="phone-bridge-dialog"
				>
					<Dialog.Title className="plugins-panel__title">
						Phone Bridge
					</Dialog.Title>
					<Dialog.Description className="plugins-panel__description">
						Connect a phone to monitor live agent sessions over your local
						network.
					</Dialog.Description>

					<PhoneBridgePanel />

					<Dialog.Close asChild>
						<button type="button" className="plugins-panel__close">
							Close
						</button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
