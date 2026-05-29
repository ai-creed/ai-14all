import { useEffect, useState } from "react";
import { codeNavClient, type WorktreeRef } from "../ipc/client.js";
import type { DefinitionRowPayload } from "../../../../shared/contracts/commands.js";

export function useSymbolSearch(ref: WorktreeRef | null, query: string) {
	const [results, setResults] = useState<DefinitionRowPayload[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!ref) {
			setResults([]);
			return;
		}
		const id = setTimeout(async () => {
			if (
				!(window as unknown as { ai14all?: { codeNav?: unknown } }).ai14all
					?.codeNav
			)
				return;
			try {
				setLoading(true);
				const out = await codeNavClient.searchSymbols(ref, {
					query,
					limit: 50,
				});
				setResults(out);
				setError(null);
			} catch (e) {
				setError((e as Error)?.message ?? "Symbol search failed");
			} finally {
				setLoading(false);
			}
		}, 80);
		return () => clearTimeout(id);
	}, [ref?.workspaceId, ref?.worktreeId, query]);

	return { results, loading, error };
}
