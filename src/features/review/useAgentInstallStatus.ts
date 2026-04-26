import { useCallback, useEffect, useState } from "react";
import { agentInstall } from "../../lib/desktop-client";

type Provider = {
	id: "claude-code" | "codex";
	displayName: string;
	cliAvailable: boolean;
	configRootDetected: boolean;
	installed: boolean;
};

export function useAgentInstallStatus() {
	const [providers, setProviders] = useState<Provider[]>([]);
	const [mcpPort, setMcpPort] = useState<number | null>(null);
	const [bindError, setBindError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const res = await agentInstall.listProviders();
		setProviders(res.providers);
		setMcpPort(res.mcp.port);
		setBindError(res.mcp.bindError);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const install = useCallback(
		async (ids: Provider["id"][]) => {
			const res = await agentInstall.install(ids);
			await refresh();
			return res.results;
		},
		[refresh],
	);

	const uninstall = useCallback(
		async (ids: Provider["id"][]) => {
			const res = await agentInstall.uninstall(ids);
			await refresh();
			return res.results;
		},
		[refresh],
	);

	return { providers, mcpPort, bindError, refresh, install, uninstall };
}
