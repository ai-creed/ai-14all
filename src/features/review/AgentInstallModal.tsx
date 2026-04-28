import { useEffect, useState } from "react";
import { AppDialog } from "../../components/AppDialog";
import type { AgentInstallStatus } from "./useAgentInstallStatus";

type Props = {
	open: boolean;
	onClose: () => void;
	status: AgentInstallStatus;
};

export function AgentInstallModal({ open, onClose, status }: Props) {
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [results, setResults] = useState<
		Record<string, { ok: boolean; message: string | null }>
	>({});
	const [busy, setBusy] = useState(false);
	const [pickError, setPickError] = useState<Record<string, string | null>>({});

	// Depend on the refresh callback (stable across renders via useCallback in
	// the hook), not the whole `status` object — that object is freshly built
	// on every render and would loop the effect.
	const { refresh } = status;
	useEffect(() => {
		if (open) void refresh();
	}, [open, refresh]);

	return (
		<AppDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
			<AppDialog.Title>Install ai-14all-fix-review skill + MCP server</AppDialog.Title>
			<AppDialog.Body>
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
						const pickMsg = pickError[p.id];
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
										? p.cliSource === "override"
											? `CLI detected (override: ${p.cliPath})`
											: "CLI detected"
										: "CLI not found"}
									{p.configRootDetected && !p.cliAvailable && (
										<span> · config dir present</span>
									)}
									{p.installed && <span> · installed</span>}
								</label>
								{!p.cliAvailable && (
									<button
										type="button"
										className="shell-button shell-button--compact"
										disabled={busy}
										onClick={async () => {
											setPickError((m) => ({ ...m, [p.id]: null }));
											const picked = await status.pickCliPath(p.id);
											if (picked.canceled || !picked.path) return;
											let response;
											try {
												response = await status.setCliOverride(
													p.id,
													picked.path,
												);
											} catch (e) {
												setPickError((m) => ({
													...m,
													[p.id]: (e as Error).message,
												}));
												return;
											}
											// Use the response payload, not status.providers —
											// the latter reflects the closed-over render and is stale.
											const refreshed = response.providers.find(
												(r) => r.id === p.id,
											);
											if (refreshed && !refreshed.cliAvailable) {
												setPickError((m) => ({
													...m,
													[p.id]: `Selected file is not a usable ${p.displayName} CLI`,
												}));
											}
										}}
									>
										Locate {p.displayName} CLI…
									</button>
								)}
								{pickMsg && <p className="shell-error">{pickMsg}</p>}
								{result && (
									<p className={result.ok ? "shell-info" : "shell-error"}>
										{result.ok ? "Installed ✓" : `Failed: ${result.message}`}
									</p>
								)}
							</li>
						);
					})}
				</ul>
			</AppDialog.Body>
			<AppDialog.Footer>
				<button
					type="button"
					className="shell-button shell-button--compact"
					onClick={onClose}
					disabled={busy}
				>
					Close
				</button>
				<button
					type="button"
					className="shell-button shell-button--compact shell-button--primary"
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
			</AppDialog.Footer>
		</AppDialog>
	);
}
