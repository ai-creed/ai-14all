import type {
	EcosystemPluginId,
	PluginSnapshot,
} from "../../../../shared/models/ecosystem-plugin";

export type PluginDescriptor = {
	title: string;
	pitch: string;
	installCommand: string;
	/** Project homepage, shown as the card's "Read more" link. */
	repoUrl: string;
};

function chipLabel(snapshot: PluginSnapshot): string {
	const s = snapshot.status;
	switch (s.state) {
		case "not-installed":
			return "not installed";
		case "installed-off":
			return "installed, off";
		case "on-healthy":
			return s.limited ? "on — limited (upgrade for live events)" : "on";
		case "degraded":
			return `degraded — ${s.reason}`;
		case "incompatible":
			return `incompatible — found ${s.found}, requires ${s.required}`;
	}
}

export function PluginCard(props: {
	descriptor: PluginDescriptor;
	snapshot: PluginSnapshot;
	onToggle: (id: EcosystemPluginId, enabled: boolean) => void;
	onInstall: (command: string) => void;
	onReprobe: () => void;
	/** Optional one-shot setup action (cortex only). Shown when installed. */
	onConfigure?: () => void;
	/** Opens the plugin's repo in the user's default browser. */
	onReadMore?: (url: string) => void;
}) {
	const { descriptor, snapshot } = props;
	const status = snapshot.status;
	const showToggle = status.state !== "not-installed";
	const showInstall = status.state === "not-installed";
	const showReprobe =
		status.state === "degraded" || status.state === "incompatible";
	const showConfigure =
		props.onConfigure !== undefined && status.state !== "not-installed";
	return (
		<div className="plugin-card" data-plugin-id={snapshot.id}>
			<div className="plugin-card-header">
				<h3>{descriptor.title}</h3>
				<span className="plugin-chip" data-state={status.state}>
					{chipLabel(snapshot)}
				</span>
			</div>
			<p className="plugin-pitch">{descriptor.pitch}</p>
			{status.state !== "not-installed" && "version" in status && (
				<p className="plugin-meta">
					v{status.version}
					{snapshot.installPath ? ` — ${snapshot.installPath}` : ""}
				</p>
			)}
			<div className="plugin-actions">
				{showToggle && (
					<button
						role="switch"
						aria-checked={snapshot.enabled}
						onClick={() => props.onToggle(snapshot.id, !snapshot.enabled)}
					>
						{snapshot.enabled ? "Enabled" : "Disabled"}
					</button>
				)}
				{showConfigure && (
					<button onClick={() => props.onConfigure?.()}>Configure</button>
				)}
				{showInstall && (
					<button onClick={() => props.onInstall(descriptor.installCommand)}>
						Install
					</button>
				)}
				{showReprobe && <button onClick={props.onReprobe}>Re-probe</button>}
			</div>
			<div className="plugin-readmore">
				<a
					href={descriptor.repoUrl}
					onClick={(e) => {
						// Route through onReadMore (shell.openExternal) so the repo opens in
						// the user's default browser, never inside this Electron window.
						e.preventDefault();
						props.onReadMore?.(descriptor.repoUrl);
					}}
				>
					Read more on GitHub ↗
				</a>
			</div>
		</div>
	);
}
