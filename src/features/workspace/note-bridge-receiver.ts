import type { Ai14AllDesktopApi } from "../../../shared/contracts/commands";
import type {
	NoteBridgeReply,
	NoteBridgeRequest,
} from "../../../shared/contracts/note-bridge";
import type { WorkspaceState, WorkspaceAction } from "./workspace-state";

export type WorkspaceLookup = {
	/** Iterates [workspaceId, state] over active + inactive workspaces. */
	forEach(cb: (workspaceId: string, state: WorkspaceState) => void): void;
};

export type WorkspaceDispatch = (
	workspaceId: string,
	action: WorkspaceAction,
) => void;

export type NoteBridgeApi = Ai14AllDesktopApi["noteBridge"];

export type InstallReceiverDeps = {
	workspaces: WorkspaceLookup;
	dispatchTo: WorkspaceDispatch;
	api: NoteBridgeApi;
	now?: () => Date;
};

const pad = (n: number) => String(n).padStart(2, "0");

function formatTimestamp(d: Date): string {
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		` ${pad(d.getHours())}:${pad(d.getMinutes())}`
	);
}

function findSession(
	workspaces: WorkspaceLookup,
	worktreeId: string,
): { workspaceId: string; note: string } | null {
	let hit: { workspaceId: string; note: string } | null = null;
	workspaces.forEach((workspaceId, state) => {
		if (hit) return;
		const session = state.sessionsByWorktreeId[worktreeId];
		if (session) hit = { workspaceId, note: session.note };
	});
	return hit;
}

export function installNoteBridgeReceiver(
	deps: InstallReceiverDeps,
): () => void {
	const { workspaces, dispatchTo, api } = deps;
	const now = deps.now ?? (() => new Date());

	const handleRequest = (req: NoteBridgeRequest) => {
		const found = findSession(workspaces, req.worktreeId);
		if (!found) {
			const reply: NoteBridgeReply = {
				id: req.id,
				ok: false,
				error: "no_session",
				message: `no session for worktreeId ${req.worktreeId}`,
			};
			api.sendReply(reply);
			return;
		}
		if (req.op === "read") {
			api.sendReply({
				id: req.id,
				ok: true,
				op: "read",
				note: found.note,
			});
			return;
		}
		const ts = formatTimestamp(now());
		const appendedSection = `## ${req.title} — ${ts}`;
		const next =
			found.note.length === 0
				? `${appendedSection}\n\n${req.body}`
				: `${found.note}\n\n${appendedSection}\n\n${req.body}`;
		dispatchTo(found.workspaceId, {
			type: "session/setNote",
			worktreeId: req.worktreeId,
			note: next,
		});
		api.sendReply({
			id: req.id,
			ok: true,
			op: "append",
			note: next,
			appendedSection,
		});
	};

	const offRequest = api.onRequest(handleRequest as (req: unknown) => void);
	api.sendReady();

	return () => {
		offRequest();
		api.sendGoodbye();
	};
}
