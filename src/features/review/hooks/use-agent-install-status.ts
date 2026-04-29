import { useCallback, useEffect, useState } from "react";
import { agentInstall } from "../../../lib/desktop-client";

export type CliSource = "override" | "path" | "fixed" | "shell" | "none";

export type Provider = {
	id: "claude-code" | "codex";
	displayName: string;
	cliAvailable: boolean;
	configRootDetected: boolean;
	installed: boolean;
	cliPath: string | null;
	cliSource: CliSource;
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

	const pickCliPath = useCallback(async (id: Provider["id"]) => {
		return agentInstall.pickCliPath(id);
	}, []);

	// setCliOverride updates state directly from the response payload (rather
	// than calling refresh()) to avoid a redundant round trip — the response
	// already contains the updated provider list. This is intentional divergence
	// from install/uninstall which call refresh() because those IPC calls return
	// only results, not the updated provider list.
	const setCliOverride = useCallback(
		async (id: Provider["id"], path: string | null) => {
			const res = await agentInstall.setCliOverride(id, path);
			setProviders(res.providers);
			setMcpPort(res.mcp.port);
			setBindError(res.mcp.bindError);
			return res;
		},
		[],
	);

	return {
		providers,
		mcpPort,
		bindError,
		refresh,
		install,
		uninstall,
		pickCliPath,
		setCliOverride,
	};
}

export type AgentInstallStatus = ReturnType<typeof useAgentInstallStatus>;
