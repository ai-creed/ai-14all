import { useState } from "react";
import {
	CheckCircleIcon,
	WarningCircleIcon,
	XIcon,
} from "@phosphor-icons/react";
import type { Provider } from "../review/hooks/use-agent-install-status";

const STORAGE_KEY = "ai14all.systemCheck.dismissedAt";

type Props = {
	providers: Provider[];
	mcpBindError: string | null;
	onOpenAgentInstall: () => void;
};

/**
 * Persistent strip at the top of the app summarising "is my setup OK?" —
 * agent CLI presence and MCP server bind status. Surfaces *only* if
 * something is wrong or not-yet-detected. When all checks pass and the user
 * dismisses, stays dismissed until the next app launch (per-session memory).
 *
 * Distinct from the WelcomeScreen agent card, which shows pre-repo-load.
 * This one is always-on while the app is loaded.
 */
export function SystemCheckStrip({
	providers,
	mcpBindError,
	onOpenAgentInstall,
}: Props) {
	const [dismissedThisSession, setDismissedThisSession] = useState(false);

	if (dismissedThisSession) return null;
	// providers starts empty before the first refresh — don't flicker.
	if (providers.length === 0 && !mcpBindError) return null;

	const noAgentCli = providers.every((p) => !p.cliAvailable);
	const issues: { kind: "warn" | "error"; message: React.ReactNode }[] = [];

	if (noAgentCli) {
		issues.push({
			kind: "warn",
			message: (
				<>
					No AI agent CLI detected.{" "}
					<button
						type="button"
						className="shell-link-button"
						onClick={onOpenAgentInstall}
					>
						Install or locate one
					</button>
					.
				</>
			),
		});
	}

	if (mcpBindError) {
		issues.push({
			kind: "error",
			message: (
				<>
					MCP server didn't bind ({mcpBindError}). Review-skill features will
					be disabled until you restart ai-14all.
				</>
			),
		});
	}

	if (issues.length === 0) return null;

	const sessionDismiss = () => {
		try {
			sessionStorage.setItem(STORAGE_KEY, Date.now().toString());
		} catch {
			// best-effort
		}
		setDismissedThisSession(true);
	};

	return (
		<div className="shell-system-check" role="status" aria-label="System check">
			{issues.map((issue, i) => (
				<div
					key={i}
					className={`shell-system-check__row shell-system-check__row--${issue.kind}`}
				>
					{issue.kind === "error" ? (
						<WarningCircleIcon
							size={14}
							weight="regular"
							aria-hidden="true"
						/>
					) : (
						<CheckCircleIcon size={14} weight="regular" aria-hidden="true" />
					)}
					<span className="shell-system-check__body">{issue.message}</span>
				</div>
			))}
			<button
				type="button"
				className="shell-system-check__dismiss"
				aria-label="Dismiss system check"
				onClick={sessionDismiss}
			>
				<XIcon size={12} weight="regular" aria-hidden="true" />
			</button>
		</div>
	);
}
