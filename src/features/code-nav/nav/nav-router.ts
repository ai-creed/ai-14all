import type { CortexNavLocation } from "./cortex-uri.js";
import type { NavHistory } from "./nav-history.js";

export interface NavTarget extends CortexNavLocation {
	source: "definition" | "reference" | "link" | "palette" | "history";
}

export interface ActiveContext {
	workspaceId: string;
	worktreeId: string;
	sessionId: string;
	currentLocation: CortexNavLocation | null;
	/**
	 * True when the current main pane is a transient preview (the prior nav
	 * was a definition jump). The next navigate() replaces in place rather
	 * than pushing the current location onto history. Spec §304.
	 */
	paneTransient: boolean;
}

export interface NavRouterDeps {
	history: NavHistory;
	dispatch: (action: unknown) => void;
	toast: (message: string) => void;
	getActive: () => ActiveContext | null;
}

export class NavRouter {
	constructor(private readonly d: NavRouterDeps) {}

	async navigate(
		target: NavTarget,
		opts?: { pushHistory?: boolean },
	): Promise<void> {
		const active = this.d.getActive();
		if (!active) return;
		if (
			target.workspaceId !== active.workspaceId ||
			target.worktreeId !== active.worktreeId
		) {
			this.d.toast("Cross-worktree navigation is not supported in this MVP.");
			return;
		}
		// A transient preview pane (prior jump from a definition) is replaced
		// in place rather than pushed onto history. Spec §299, §304.
		const shouldPush =
			opts?.pushHistory !== false &&
			active.currentLocation !== null &&
			!active.paneTransient;
		if (shouldPush) {
			this.d.history.push(active.worktreeId, active.currentLocation!);
		}
		this.dispatchSelect(
			active.sessionId,
			target,
			target.source === "definition",
		);
	}

	async back(worktreeId: string): Promise<void> {
		const prev = this.d.history.back(worktreeId);
		const active = this.d.getActive();
		if (prev && active)
			this.dispatchSelect(
				active.sessionId,
				{ ...prev, source: "history" },
				false,
			);
	}

	async forward(worktreeId: string): Promise<void> {
		const next = this.d.history.forward(worktreeId);
		const active = this.d.getActive();
		if (next && active)
			this.dispatchSelect(
				active.sessionId,
				{ ...next, source: "history" },
				false,
			);
	}

	private dispatchSelect(_sessionId: string, t: NavTarget, transient: boolean) {
		this.d.dispatch({
			type: "session/selectFileAtLocation",
			worktreeId: t.worktreeId,
			relativePath: t.file,
			revealLine: t.line,
			revealColumn: t.column,
			transient,
		});
	}
}
