import * as monaco from "monaco-editor";
import { codeNavClient } from "../ipc/client.js";
import { getActiveWorktreeRef } from "../nav/active-worktree-ref.js";
import { getModelProvisioner } from "../nav/router-singleton.js";
import type { ProvisionRef } from "./model-provisioner.js";
import {
	buildDefinitionLocations,
	type DefRow,
} from "./build-definition-locations.js";

// Cache the cortex rows (cheap structural data), not Monaco Locations: we
// re-provision models on every call so a peek never references a model the LRU
// evicted since the last lookup (ensureModel reuses, so the rebuild is cheap).
const cache = new Map<string, { at: number; rows: DefRow[] }>();
const TTL_MS = 30_000;

export const definitionProvider: monaco.languages.DefinitionProvider = {
	async provideDefinition(model, position) {
		const word = model.getWordAtPosition(position);
		if (!word) return null;
		const ref = getActiveWorktreeRef();
		if (!ref) return null;
		const provisioner = getModelProvisioner();
		if (!provisioner) return null;

		const callerFile = relativeFromCortexUri(model.uri.toString());
		const key = `${ref.worktreeId}:${(model as { id?: string }).id ?? model.uri.toString()}:${position.lineNumber}:${position.column}`;
		const cached = cache.get(key);
		let rows: DefRow[] | undefined = cached?.rows;
		if (!cached || Date.now() - cached.at >= TTL_MS) {
			try {
				rows = await codeNavClient.findDefinitions(
					{ workspaceId: ref.workspaceId, worktreeId: ref.worktreeId },
					{ name: word.word, callerFile },
				);
			} catch {
				return null;
			}
			cache.set(key, { at: Date.now(), rows });
		}
		if (!rows) return null;

		const provRef: ProvisionRef = {
			workspaceId: ref.workspaceId,
			worktreeId: ref.worktreeId,
			worktreeRoot: ref.worktreeRoot,
		};
		const built = await buildDefinitionLocations(rows, provRef, (r, rel) =>
			provisioner.ensureModel(r, rel),
		);
		const result: monaco.languages.Location[] = built.map((b) => ({
			uri: monaco.Uri.parse(b.uriString),
			range: new monaco.Range(
				b.range.startLine,
				b.range.startCol,
				b.range.endLine,
				b.range.endCol,
			),
		}));

		// (The __codeNavTestLastDefUri e2e seam is set inside
		// buildDefinitionLocations so the unit test covers it.)
		return result;
	},
};

function relativeFromCortexUri(uri: string): string | undefined {
	if (!uri.startsWith("cortex://nav/")) return undefined;
	const u = new URL(uri);
	const parts = u.pathname.replace(/^\//, "").split("/");
	return parts.slice(2).map(decodeURIComponent).join("/");
}

export function invalidateDefinitionCache(): void {
	cache.clear();
}
