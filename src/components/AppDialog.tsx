import { Children, isValidElement, type ReactNode } from "react";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";

type AppDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	size?: "default" | "wide";
	children: ReactNode;
};

export function Title({ children }: { children: ReactNode }) {
	return (
		<DialogTitle className="shell-app-dialog__title">{children}</DialogTitle>
	);
}
Title.displayName = "AppDialog.Title";

export function Description({ children }: { children: ReactNode }) {
	return (
		<DialogDescription className="shell-app-dialog__description">
			{children}
		</DialogDescription>
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
	const className = size === "wide" ? "shell-app-dialog--wide" : undefined;
	const contentProps = hasDescriptionChild(children)
		? {}
		: { "aria-describedby": undefined };
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={className} {...contentProps}>
				{children}
			</DialogContent>
		</Dialog>
	);
}

AppDialog.Title = Title;
AppDialog.Description = Description;
AppDialog.Body = Body;
AppDialog.Footer = Footer;
