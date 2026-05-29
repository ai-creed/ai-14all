type Listener = (e: { workspaceId: string; worktreeId: string }) => void;

const listeners = new Set<Listener>();
let installed = false;

function ensureInstalled() {
	if (installed) return;
	installed = true;
	window.ai14all.codeNav.onWorktreeIndexRefreshed((e) => {
		for (const l of listeners) l(e);
	});
}

export function subscribeWorktreeIndexRefreshed(cb: Listener): () => void {
	ensureInstalled();
	listeners.add(cb);
	return () => listeners.delete(cb);
}
