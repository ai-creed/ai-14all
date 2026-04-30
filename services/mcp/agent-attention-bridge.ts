import { ipcMain as defaultIpcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
	AGENT_ATTENTION_BRIDGE_GOODBYE,
	AGENT_ATTENTION_BRIDGE_READY,
	AGENT_ATTENTION_BRIDGE_REPLY,
	AGENT_ATTENTION_BRIDGE_REQUEST,
	type AgentAttentionBridgeReply,
	type AgentAttentionBridgeRequest,
} from "../../shared/contracts/agent-attention-bridge.js";

export {
	BridgeDisposedError,
	BridgeTimeoutError,
	RendererGoneError,
	RendererNotReadyError,
} from "./session-note-bridge.js";

import {
	BridgeDisposedError,
	BridgeTimeoutError,
	RendererGoneError,
	RendererNotReadyError,
} from "./session-note-bridge.js";

type Pending = {
	resolve: () => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
};

type Deps = {
	ipcMain?: Electron.IpcMain;
	timeoutMs?: number;
};

type CodedError = Error & { code?: string };

export class AgentAttentionBridge {
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
	private readonly replyHandler = (_: unknown, reply: AgentAttentionBridgeReply) => {
		const p = this.pending.get(reply.id);
		if (!p) return; // unknown id — drop
		this.pending.delete(reply.id);
		clearTimeout(p.timer);
		if (reply.ok) {
			p.resolve();
		} else {
			const err: CodedError = new Error(reply.message);
			err.code = reply.error;
			p.reject(err);
		}
	};

	constructor(
		private readonly getWebContents: () => Electron.WebContents | null,
		deps: Deps = {},
	) {
		this.ipcMain = deps.ipcMain ?? defaultIpcMain;
		this.timeoutMs = deps.timeoutMs ?? 5_000;
		this.ipcMain.on(AGENT_ATTENTION_BRIDGE_READY, this.readyHandler);
		this.ipcMain.on(AGENT_ATTENTION_BRIDGE_GOODBYE, this.goodbyeHandler);
		this.ipcMain.on(AGENT_ATTENTION_BRIDGE_REPLY, this.replyHandler);
	}

	report(body: Omit<AgentAttentionBridgeRequest, "id">): Promise<void> {
		if (this.disposed) {
			return Promise.reject(new BridgeDisposedError("bridge disposed"));
		}
		if (!this.rendererReady) {
			return Promise.reject(new RendererNotReadyError("renderer not ready"));
		}
		const wc = this.getWebContents();
		if (!wc) {
			return Promise.reject(new RendererNotReadyError("webContents unavailable"));
		}
		const id = randomUUID();
		const req: AgentAttentionBridgeRequest = { id, ...body };
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.delete(id)) {
					reject(new BridgeTimeoutError("bridge reply timed out"));
				}
			}, this.timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			wc.send(AGENT_ATTENTION_BRIDGE_REQUEST, req);
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.ipcMain.removeListener(AGENT_ATTENTION_BRIDGE_READY, this.readyHandler);
		this.ipcMain.removeListener(AGENT_ATTENTION_BRIDGE_GOODBYE, this.goodbyeHandler);
		this.ipcMain.removeListener(AGENT_ATTENTION_BRIDGE_REPLY, this.replyHandler);
		for (const [, p] of this.pending) {
			clearTimeout(p.timer);
			p.reject(new BridgeDisposedError("bridge disposed"));
		}
		this.pending.clear();
	}
}
