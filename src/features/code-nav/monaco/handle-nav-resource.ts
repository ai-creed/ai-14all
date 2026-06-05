import { decodeCortexUri } from "../nav/cortex-uri.js";
import { fromFileUri } from "../nav/nav-file-uri.js";
import type { NavRouter } from "../nav/nav-router.js";
import type { ActiveWorktreeRef } from "../nav/active-worktree-ref.js";

export interface NavResourceSelection {
	startLineNumber?: number;
	startColumn?: number;
	lineNumber?: number;
	column?: number;
}

export interface HandleNavResourceDeps {
	getRouter: () => Pick<NavRouter, "navigate"> | null;
	getActiveRef: () => ActiveWorktreeRef | null;
	getToast: () => ((msg: string) => void) | null;
	outsideWorktreeUri: string;
}

/**
 * Single dispatch for "open this resource" gestures (Go to Definition, Peek
 * selection, diff link). Returns true when handled so Monaco stops walking
 * openers. `cortex://` carries its own location (diff links); `file://` is a
 * definition target whose workspace/worktree come from the active ref and whose
 * line/column come from the selection Monaco passes when opening.
 */
export async function handleNavResource(
	uriString: string,
	selection: NavResourceSelection | undefined,
	source: "definition" | "link",
	deps: HandleNavResourceDeps,
): Promise<boolean> {
	if (uriString === deps.outsideWorktreeUri) {
		deps.getToast()?.("Path outside this worktree");
		return true;
	}

	const cortexLoc = decodeCortexUri(uriString);
	if (cortexLoc) {
		await deps.getRouter()?.navigate({ ...cortexLoc, source });
		return true;
	}

	const ref = deps.getActiveRef();
	if (ref?.worktreeRoot) {
		const relFile = fromFileUri(ref.worktreeRoot, uriString);
		if (relFile !== null) {
			const line = selection?.startLineNumber ?? selection?.lineNumber ?? 1;
			const column = selection?.startColumn ?? selection?.column ?? 1;
			await deps.getRouter()?.navigate({
				workspaceId: ref.workspaceId,
				worktreeId: ref.worktreeId,
				file: relFile,
				line,
				column,
				source,
			});
			return true;
		}
	}

	return false;
}
