import * as Popover from "@radix-ui/react-popover";
import { QuestionIcon } from "@phosphor-icons/react";

type Props = {
	term: string;
	children: React.ReactNode;
	/** Where to anchor the popover relative to the trigger. */
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
};

/**
 * Inline "(?)" affordance for explaining a domain term in place. Click reveals
 * a small popover with the explanation (and any inline links). Designed to be
 * sprinkled at the FIRST occurrence of jargon in each surface — sidebar
 * "Sessions", chipbar "Worktree", terminal "Promote to master", etc. — not
 * on every appearance.
 *
 * Defaults to side="top" align="start" so the popover doesn't shift the
 * surrounding chrome around when it opens.
 */
export function HelpHint({
	term,
	children,
	side = "top",
	align = "start",
}: Props) {
	return (
		<Popover.Root>
			<Popover.Trigger asChild>
				<button
					type="button"
					className="shell-help-hint"
					aria-label={`What is "${term}"?`}
				>
					<QuestionIcon size={10} weight="regular" aria-hidden="true" />
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					className="shell-help-hint__popover"
					side={side}
					align={align}
					sideOffset={6}
				>
					<div className="shell-help-hint__term">{term}</div>
					<div className="shell-help-hint__body">{children}</div>
					<Popover.Arrow className="shell-help-hint__arrow" />
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
