import { ipcMain as defaultIpcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
	NOTE_BRIDGE_GOODBYE,
	NOTE_BRIDGE_READY,
	NOTE_BRIDGE_REPLY,
	NOTE_BRIDGE_REQUEST,
	type NoteBridgeReply,
	type NoteBridgeReplyError,
	type NoteBridgeRequest,
} from "../../shared/contracts/note-bridge.js";

export class RendererNotReadyError extends Error {
	override name = "RendererNotReadyError";
}
export class RendererGoneError extends Error {
	override name = "RendererGoneError";
}
export class BridgeTimeoutError extends Error {
	override name = "BridgeTimeoutError";
}
export class BridgeDisposedError extends Error {
	override name = "BridgeDisposedError";
}

type Pending = {
	resolve: (reply: NoteBridgeReply) => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
};

type Deps = {
	ipcMain?: Electron.IpcMain;
	timeoutMs?: number;
};

type CodedError = Error & { code?: string };

function throwReplyError(r: NoteBridgeReplyError): never {
	const err: CodedError = new Error(r.message);
	err.code = r.error;
	throw err;
}

export class SessionNoteBridge {
	private readonly ipcMain: Electron.IpcMain;
	private readonly timeoutMs: number;
	private readonly pending = new Map<string, Pending>();
	private rendererReady = false;
	private disposed = false;
	private readonly readyHandler = () => {
		this.rendererReady = true;
	};
	private readonly goodbyeHandler = () => {
		this.rendererReady = false;
		for (const [, p] of this.pending) {
			clearTimeout(p.timer);
			p.reject(new RendererGoneError("renderer announced goodbye"));
		}
		this.pending.clear();
	};
	private readonly replyHandler = (
		_: unknown,
		reply: NoteBridgeReply,
	) => {
		const p = this.pending.get(reply.id);
		if (!p) return; // unknown id — drop
		this.pending.delete(reply.id);
		clearTimeout(p.timer);
		p.resolve(reply);
	};

	constructor(
		private readonly getWebContents: () => Electron.WebContents | null,
		deps: Deps = {},
	) {
		this.ipcMain = deps.ipcMain ?? defaultIpcMain;
		this.timeoutMs = deps.timeoutMs ?? 5000;
		this.ipcMain.on(NOTE_BRIDGE_READY, this.readyHandler);
		this.ipcMain.on(NOTE_BRIDGE_GOODBYE, this.goodbyeHandler);
		this.ipcMain.on(NOTE_BRIDGE_REPLY, this.replyHandler);
	}

	read(worktreeId: string): Promise<{ note: string }> {
		return this.send({ op: "read", worktreeId }).then((r) => {
			if (!r.ok) throwReplyError(r);
			if (r.op !== "read") throw new Error("bridge protocol mismatch");
			return { note: r.note };
		});
	}

	append(
		worktreeId: string,
		title: string,
		body: string,
	): Promise<{ note: string; appendedSection: string }> {
		return this.send({ op: "append", worktreeId, title, body }).then((r) => {
			if (!r.ok) throwReplyError(r);
			if (r.op !== "append") throw new Error("bridge protocol mismatch");
			return { note: r.note, appendedSection: r.appendedSection };
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.ipcMain.removeListener(NOTE_BRIDGE_READY, this.readyHandler);
		this.ipcMain.removeListener(NOTE_BRIDGE_GOODBYE, this.goodbyeHandler);
		this.ipcMain.removeListener(NOTE_BRIDGE_REPLY, this.replyHandler);
		for (const [, p] of this.pending) {
			clearTimeout(p.timer);
			p.reject(new BridgeDisposedError("bridge disposed"));
		}
		this.pending.clear();
	}

	private send(
		body:
			| { op: "read"; worktreeId: string }
			| { op: "append"; worktreeId: string; title: string; body: string },
	): Promise<NoteBridgeReply> {
		if (!this.rendererReady) {
			return Promise.reject(
				new RendererNotReadyError("renderer not ready"),
			);
		}
		const wc = this.getWebContents();
		if (!wc) {
			return Promise.reject(
				new RendererNotReadyError("webContents unavailable"),
			);
		}
		const id = randomUUID();
		const req: NoteBridgeRequest = { id, ...body } as NoteBridgeRequest;
		return new Promise<NoteBridgeReply>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.delete(id)) {
					reject(new BridgeTimeoutError("bridge reply timed out"));
				}
			}, this.timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			wc.send(NOTE_BRIDGE_REQUEST, req);
		});
	}
}
