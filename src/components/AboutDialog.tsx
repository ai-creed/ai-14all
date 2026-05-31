import { AppDialog } from "./AppDialog";
import { system } from "../lib/desktop-client";

type Props = {
	open: boolean;
	onClose: () => void;
};

const APP_VERSION = "0.7.1";
const REPO_URL = "https://github.com/ai-creed/ai-14all";

/**
 * "About ai-14all" panel with version, what the app does, where local data
 * lives, and links to project resources. Opened from the Welcome screen and
 * the in-chrome help button.
 */
export function AboutDialog({ open, onClose }: Props) {
	const handleLink = (url: string) => (e: React.MouseEvent) => {
		e.preventDefault();
		void system.openExternal(url);
	};

	return (
		<AppDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<AppDialog.Title>About ai-14all</AppDialog.Title>
			<AppDialog.Description>
				Version {APP_VERSION}
			</AppDialog.Description>
			<AppDialog.Body>
				<p>
					ai-14all is a terminal-first desktop shell for orchestrating AI
					coding agents across Git worktrees. Each session is pinned to one
					worktree; the terminal is the primary surface, and file review,
					notes, and Git inspection are summoned on demand.
				</p>

				<h3 className="shell-about__heading">Core ideas</h3>
				<ul className="shell-about__list">
					<li>
						<strong>One session, one worktree.</strong> Every agent gets its
						own branch and working directory — no clobbering each other's
						work.
					</li>
					<li>
						<strong>Supervised parallelism.</strong> Run multiple agents
						side-by-side using the terminal layout grid (⌘⇧L).
					</li>
					<li>
						<strong>Attention states.</strong> The sidebar shows which agents
						are working, waiting on you, done, or failed.
					</li>
				</ul>

				<h3 className="shell-about__heading">Local data &amp; privacy</h3>
				<ul className="shell-about__list">
					<li>
						Local logs:{" "}
						<code>~/Library/Logs/ai-14all/</code> (Electron default).
					</li>
					<li>
						No network telemetry is collected. The auto-updater checks GitHub
						for new releases.
					</li>
					<li>
						Raw terminal output is only captured when the
						{" "}<code>AI14ALL_AGENT_ATTENTION_LOG</code> env var is set to
						<code> full</code>.
					</li>
				</ul>

				<h3 className="shell-about__heading">Links</h3>
				<ul className="shell-about__list">
					<li>
						<a
							className="shell-link"
							href={REPO_URL}
							onClick={handleLink(REPO_URL)}
						>
							Project on GitHub
						</a>
					</li>
					<li>
						<a
							className="shell-link"
							href={`${REPO_URL}/blob/master/README.md`}
							onClick={handleLink(`${REPO_URL}/blob/master/README.md`)}
						>
							README
						</a>
					</li>
					<li>
						<a
							className="shell-link"
							href={`${REPO_URL}/blob/master/CHANGELOG.md`}
							onClick={handleLink(`${REPO_URL}/blob/master/CHANGELOG.md`)}
						>
							Changelog
						</a>
					</li>
				</ul>
			</AppDialog.Body>
			<AppDialog.Footer>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--primary"
					onClick={onClose}
				>
					Close
				</button>
			</AppDialog.Footer>
		</AppDialog>
	);
}
