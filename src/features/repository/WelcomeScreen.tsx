import { CheckIcon } from "@phosphor-icons/react";
import type { Provider } from "../review/hooks/use-agent-install-status";
import { RepositoryInput } from "./RepositoryInput";

type Props = {
	onLoadPath: (path: string) => Promise<void>;
	providers: Provider[];
	onOpenAgentInstall: () => void;
	onOpenAbout: () => void;
	startupError: string | null;
	error: string | null;
};

/**
 * Cold-start landing screen. Replaces the bare "Repository" form with a short
 * primer explaining what the app does, a proactive agent-CLI status card, and
 * a link to the About panel. Shown only when there is no loaded repository
 * (App.tsx `!repository` branch).
 */
export function WelcomeScreen({
	onLoadPath,
	providers,
	onOpenAgentInstall,
	onOpenAbout,
	startupError,
	error,
}: Props) {
	const installedProviders = providers.filter((p) => p.cliAvailable);
	// providers starts empty before the first refresh; only show the warning
	// once we have data AND none are detected, to avoid a flicker on cold load.
	const showAgentWarning =
		providers.length > 0 && installedProviders.length === 0;
	const showAgentDetected = installedProviders.length > 0;

	return (
		<main className="shell-app shell-app--setup">
			<section className="shell-panel shell-setup-panel">
				<h1 className="shell-setup-title">ai-14all</h1>
				<p className="shell-setup-tagline">
					Run multiple AI coding agents in parallel — each in its own git
					branch and working directory.
				</p>

				{showAgentWarning && (
					<div className="shell-setup-card shell-setup-card--warn" role="status">
						<div className="shell-setup-card__title">
							No AI agent CLI detected
						</div>
						<p className="shell-setup-card__body">
							ai-14all works best with Claude Code or Codex CLI installed.
							You can continue without one, but agent-specific features
							(presets, attention tracking, review skill) will be limited.
						</p>
						<div className="shell-setup-card__actions">
							<button
								type="button"
								className="shell-button shell-button--compact shell-button--primary"
								onClick={onOpenAgentInstall}
							>
								Install or locate an agent CLI
							</button>
						</div>
					</div>
				)}

				{showAgentDetected && (
					<div className="shell-setup-card shell-setup-card--ok" role="status">
						<div className="shell-setup-card__title">
							<CheckIcon
								size={14}
								weight="regular"
								aria-hidden="true"
								style={{ verticalAlign: "middle", marginRight: 6 }}
							/>
							Detected:{" "}
							{installedProviders.map((p) => p.displayName).join(", ")}
						</div>
					</div>
				)}

				<h2>Open a repository</h2>
				<p className="shell-setup-hint">
					Point ai-14all at a git repository. Each session you create runs on
					its own branch in its own worktree, so multiple agents never clobber
					each other's work.
				</p>
				<RepositoryInput onLoadPath={onLoadPath} />
				{startupError && (
					<p className="shell-error" role="alert">
						{startupError}
					</p>
				)}
				{error && (
					<p className="shell-error" role="alert">
						{error}
					</p>
				)}

				<div className="shell-setup-footer">
					<button
						type="button"
						className="shell-link-button"
						onClick={onOpenAbout}
					>
						About ai-14all
					</button>
				</div>
			</section>
		</main>
	);
}
