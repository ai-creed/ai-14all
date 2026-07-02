import type { ReactElement } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Wraps a single truncated sidebar element so its full text is shown on
 * hover/focus via the Radix tooltip (replacing slow, inconsistent native
 * `title=`). `children` must be a single ref-forwarding element (`asChild`).
 */
export function SidebarTooltip({
	label,
	children,
}: {
	label: string;
	children: ReactElement;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
