import { useEffect, useState } from "react";
import { useAgentInstallStatus } from "./useAgentInstallStatus";

type Props = {
	open: boolean;
	onClose: () => void;
};

export function AgentInstallModal({ open, onClose }: Props) {
	const status = useAgentInstallStatus();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [results, setResults] = useState<
		Record<string, { ok: boolean; message: string | null }>
	>({});
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) void status.refresh();
	}, [open, status]);

	if (!open) return null;
	return (
		<div
			className="shell-modal"
			role="dialog"
			aria-label="Install agent integration"
		>
			<div className="shell-modal__panel">
				<h2>Install ai-14all-fix-review skill + MCP server</h2>
				{status.bindError && (
					<p className="shell-error">
						MCP server could not bind. {status.bindError}. Resolve and restart
						ai-14all.
					</p>
				)}
				<ul className="shell-install-list">
					{status.providers.map((p) => {
						const enabled = p.cliAvailable;
						const result = results[p.id];
						return (
							<li key={p.id}>
								<label>
									<input
										type="checkbox"
										disabled={!enabled || busy}
										checked={selected.has(p.id)}
										onChange={() => {
											const next = new Set(selected);
											if (next.has(p.id)) next.delete(p.id);
											else next.add(p.id);
											setSelected(next);
										}}
									/>
									{p.displayName} —{" "}
									{p.cliAvailable
										? "CLI detected"
										: "CLI not on PATH — install the CLI or use Other agents below"}
									{p.configRootDetected && !p.cliAvailable && (
										<span> · config dir present</span>
									)}
									{p.installed && <span> · installed</span>}
								</label>
								{result && (
									<p className={result.ok ? "shell-info" : "shell-error"}>
										{result.ok ? "Installed ✓" : `Failed: ${result.message}`}
									</p>
								)}
							</li>
						);
					})}
				</ul>
				<div className="shell-modal__actions">
					<button type="button" onClick={onClose} disabled={busy}>
						Close
					</button>
					<button
						type="button"
						disabled={selected.size === 0 || busy}
						onClick={async () => {
							setBusy(true);
							const r = await status.install(
								Array.from(selected) as ("claude-code" | "codex")[],
							);
							const map: Record<
								string,
								{ ok: boolean; message: string | null }
							> = {};
							for (const item of r)
								map[item.id] = { ok: item.ok, message: item.message };
							setResults(map);
							setBusy(false);
						}}
					>
						Install
					</button>
				</div>
			</div>
		</div>
	);
}
