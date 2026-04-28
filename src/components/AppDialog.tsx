import * as Dialog from "@radix-ui/react-dialog";
import { Children, isValidElement, type ReactNode } from "react";

type AppDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	size?: "default" | "wide";
	children: ReactNode;
};

export function Title({ children }: { children: ReactNode }) {
	return (
		<Dialog.Title className="shell-app-dialog__title">{children}</Dialog.Title>
	);
}
Title.displayName = "AppDialog.Title";

export function Description({ children }: { children: ReactNode }) {
	return (
		<Dialog.Description className="shell-app-dialog__description">
			{children}
		</Dialog.Description>
	);
}
Description.displayName = "AppDialog.Description";

export function Body({ children }: { children: ReactNode }) {
	return <div className="shell-app-dialog__body">{children}</div>;
}
Body.displayName = "AppDialog.Body";

export function Footer({ children }: { children: ReactNode }) {
	return <div className="shell-app-dialog__footer">{children}</div>;
}
Footer.displayName = "AppDialog.Footer";

function hasDescriptionChild(children: ReactNode): boolean {
	return Children.toArray(children).some(
		(child) => isValidElement(child) && child.type === Description,
	);
}

export function AppDialog({
	open,
	onOpenChange,
	size = "default",
	children,
}: AppDialogProps) {
	const className =
		size === "wide"
			? "shell-app-dialog shell-app-dialog--wide"
			: "shell-app-dialog";
	const contentProps = hasDescriptionChild(children)
		? {}
		: { "aria-describedby": undefined };
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-app-dialog__overlay" />
				<Dialog.Content className={className} {...contentProps}>
					{children}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

AppDialog.Title = Title;
AppDialog.Description = Description;
AppDialog.Body = Body;
AppDialog.Footer = Footer;
