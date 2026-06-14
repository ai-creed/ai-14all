import type { ReactNode } from "react";

type Props = {
	/** Agent launcher chips (left). Null when no providers are detected. */
	agentLauncher: ReactNode;
	/** Relocated terminal action chips (+ Shell / Layout / Presets), right. */
	terminalActions: ReactNode;
};

/**
 * A strip between the session chip-bar and the terminal layer that owns
 * terminal/shell chrome: agent launchers on the left, terminal actions on the
 * right. A sibling of the Session region (NOT aria-label="Session"), so the
 * global shortcuts and the Session-region geometry are unaffected (spec §8).
 */
export function TerminalChromeHeader({
	agentLauncher,
	terminalActions,
}: Props) {
	return (
		<div
			className="terminal-chrome-header"
			role="region"
			aria-label="Terminal controls"
		>
			{agentLauncher}
			<div className="terminal-chrome-header__actions">{terminalActions}</div>
		</div>
	);
}
