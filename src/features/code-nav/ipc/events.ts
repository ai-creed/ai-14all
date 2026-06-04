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

type UnavailableListener = (e: {
	workspaceId: string;
	worktreeId: string;
	reason: "no-cortex" | "unsupported-schema";
}) => void;

const unavailableListeners = new Set<UnavailableListener>();
let unavailableInstalled = false;

function ensureUnavailableInstalled() {
	if (unavailableInstalled) return;
	unavailableInstalled = true;
	window.ai14all.codeNav.onWorktreeUnavailable((e) => {
		for (const l of unavailableListeners) l(e);
	});
}

export function subscribeWorktreeUnavailable(
	cb: UnavailableListener,
): () => void {
	ensureUnavailableInstalled();
	unavailableListeners.add(cb);
	return () => unavailableListeners.delete(cb);
}
