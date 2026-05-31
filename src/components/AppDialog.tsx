import { Children, isValidElement, type ReactNode } from "react";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type AppDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	size?: "default" | "wide";
	children: ReactNode;
};

export function Title({ children }: { children: ReactNode }) {
	return (
		<DialogTitle className="text-base font-semibold">{children}</DialogTitle>
	);
}
Title.displayName = "AppDialog.Title";

export function Description({ children }: { children: ReactNode }) {
	return (
		<DialogDescription className="text-sm text-muted-foreground mt-1">
			{children}
		</DialogDescription>
	);
}
Description.displayName = "AppDialog.Description";

export function Body({ children }: { children: ReactNode }) {
	return <div className="mt-3 space-y-3">{children}</div>;
}
Body.displayName = "AppDialog.Body";

export function Footer({ children }: { children: ReactNode }) {
	return <div className="mt-4 flex justify-end gap-2">{children}</div>;
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
	const contentProps = hasDescriptionChild(children)
		? {}
		: { "aria-describedby": undefined };
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(
					size === "wide"
						? "max-w-[min(640px,calc(100vw-32px))]"
						: "max-w-[min(460px,calc(100vw-32px))]",
				)}
				{...contentProps}
			>
				{children}
			</DialogContent>
		</Dialog>
	);
}

AppDialog.Title = Title;
AppDialog.Description = Description;
AppDialog.Body = Body;
AppDialog.Footer = Footer;
