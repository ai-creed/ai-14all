import type { SamanthaFocusWorktree } from "../../../shared/contracts/plugins";

export type FocusWorktreeEffectOptions = {
	/** Push the focus selection to the renderer (best-effort UI). */
	send: (payload: SamanthaFocusWorktree) => void;
	/** Raise + focus the main window (guarded against a destroyed window). */
	raiseWindow: () => void;
	/** Read the live `focusRaisesWindow` knob at dispatch time. */
	getFocusRaisesWindow: () => boolean;
};

export function createFocusWorktreeEffect(
	opts: FocusWorktreeEffectOptions,
): (worktreeId: string) => void {
	return (worktreeId) => {
		opts.send({ worktreeId });
		if (opts.getFocusRaisesWindow()) opts.raiseWindow();
	};
}
