import type { ITheme } from "xterm";
import { Icon } from "@/components/ui/icon";
import type { ProcessSession } from "../../../../shared/models/process-session";
import type { TerminalSession } from "../../../../shared/models/terminal-session";
import { TerminalPane } from "./TerminalPane";

type Props = {
	process: ProcessSession;
	session: TerminalSession | null;
	theme: ITheme;
	/** True when the grid is full (6 slots) — pin has no room to promote. */
	pinDisabled: boolean;
	onMinimize: (processId: string) => void;
	onPin: (processId: string) => void;
	onClose: (processId: string) => void;
	onTitleChange: (title: string) => void;
};

/**
 * The expanded throwaway shell, a header-anchored drop-down popover over the
 * grid. Reuses TerminalPane for the body so it inherits replay-on-mount and the
 * existing xterm key handling. After the shell exits it lingers (the retained
 * replay buffer repopulates the pane) until the user dismisses it.
 */
export function FloatingShellPopover({
	process,
	session,
	theme,
	pinDisabled,
	onMinimize,
	onPin,
	onClose,
	onTitleChange,
}: Props) {
	const exited = process.status === "exited" || process.status === "error";
	return (
		<div
			className="floating-shell-popover"
			data-testid="floating-shell-popover"
			role="dialog"
			aria-label={`Throwaway shell ${process.label}`}
		>
			<header className="floating-shell-popover__header">
				<span
					className="floating-shell-popover__dot"
					data-exited={exited ? "true" : "false"}
					aria-hidden="true"
				/>
				<span className="floating-shell-popover__title">{process.label}</span>
				<button
					type="button"
					aria-label="Pin into layout"
					title={
						pinDisabled
							? "Layout full — free a slot first"
							: "Pin into layout"
					}
					data-testid="floating-shell-pin"
					disabled={pinDisabled || exited}
					onClick={() => onPin(process.id)}
				>
					<Icon name="pin" />
				</button>
				<button
					type="button"
					aria-label="Minimize floating shell"
					title="Minimize"
					data-testid="floating-shell-minimize"
					onClick={() => onMinimize(process.id)}
				>
					<Icon name="minimize" />
				</button>
				<button
					type="button"
					aria-label="Kill floating shell"
					title="Kill"
					data-testid="floating-shell-close"
					onClick={() => onClose(process.id)}
				>
					<Icon name="close" />
				</button>
			</header>
			<div className="floating-shell-popover__body">
				{session && (
					<TerminalPane
						session={session}
						visible={true}
						focused
						theme={theme}
						onTitleChange={onTitleChange}
					/>
				)}
			</div>
		</div>
	);
}
