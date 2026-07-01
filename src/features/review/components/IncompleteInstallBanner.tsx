import type { Provider } from "../hooks/use-agent-install-status";
import {
	installGapSignature,
	useInstallGapDismissal,
} from "../logic/use-install-gap-dismissal";

type Props = {
	providers: Provider[];
	onInstall: () => void;
};

/**
 * Slim, dismissible top-of-app strip shown when ai-14all's agent integration is
 * incomplete — at least one detected CLI has no skill/MCP wired. Reuses the
 * existing install modal via onInstall. Renders nothing when there is no gap or
 * the current gap was already dismissed.
 */
export function IncompleteInstallBanner({
	providers,
	onInstall,
}: Props): React.ReactElement | null {
	const signature = installGapSignature(providers);
	const { visible, dismiss } = useInstallGapDismissal(signature);
	if (!visible) return null;

	// `visible` guarantees signature !== "", so there is at least one gap.
	const gaps = providers.filter((p) => p.cliAvailable && !p.installed);
	const message =
		gaps.length === 1
			? `⚡ Connect ${gaps[0].displayName} to ai-14all — let it fix review comments and report status`
			: `⚡ ${gaps.length} agents aren't connected to ai-14all`;

	return (
		<div
			className="shell-install-banner"
			role="status"
			data-testid="incomplete-install-banner"
		>
			<span className="shell-install-banner__msg">{message}</span>
			<div className="shell-install-banner__actions">
				<button
					type="button"
					className="shell-install-banner__install"
					onClick={onInstall}
				>
					Install…
				</button>
				<button
					type="button"
					className="shell-install-banner__dismiss"
					aria-label="Dismiss"
					onClick={dismiss}
				>
					×
				</button>
			</div>
		</div>
	);
}
