// services/plugins/samantha/samantha-connector-client.ts
import { request } from "node:http";

export type SamanthaClientResult =
	| { ok: true }
	| { ok: false; reason: "not-found" | "conflict" | "refused" | "error" };

export type SourceCapability = { id: string; title: string };

export type RegisterBody = {
	id: "ai-14all";
	label: "ai-14all";
	description: string;
	capabilities: SourceCapability[];
	// Canonical contract version (additive). Samantha checks compatibility on
	// register and disables commanding on a mismatch.
	contractVersion: number;
};

export type SnapshotBody = {
	summary: string;
	status: string;
	details: Record<string, string>;
	updatedAt: number;
	/** Generic self-describing structured payload (e.g. the supervisor worktree list). */
	data?: { kind: string; version: number; payload: unknown };
};

export type EventBody = {
	signal: string;
	summary: string;
	details?: Record<string, string>;
};

export type SamanthaConnectorClient = {
	register(body: RegisterBody): Promise<SamanthaClientResult>;
	patchSnapshot(body: SnapshotBody): Promise<SamanthaClientResult>;
	postEvent(body: EventBody): Promise<SamanthaClientResult>;
	unregister(): Promise<SamanthaClientResult>;
};

function classify(status: number): SamanthaClientResult {
	if (status >= 200 && status < 300) return { ok: true };
	if (status === 404) return { ok: false, reason: "not-found" };
	if (status === 409) return { ok: false, reason: "conflict" };
	return { ok: false, reason: "error" };
}

export function createSamanthaConnectorClient(
	opts: { host?: string; port?: number } = {},
): SamanthaConnectorClient {
	const host = opts.host ?? "127.0.0.1";
	const port =
		opts.port ?? (Number(process.env.AI_SAMANTHA_CONNECTOR_PORT) || 7841);

	function send(
		method: string,
		path: string,
		body: unknown,
	): Promise<SamanthaClientResult> {
		return new Promise((resolve) => {
			const payload = body === undefined ? "" : JSON.stringify(body);
			const req = request(
				{
					host,
					port,
					path,
					method,
					headers: {
						"content-type": "application/json",
						"content-length": Buffer.byteLength(payload),
					},
				},
				(res) => {
					// Drain so the socket can be reused/closed; we only need the status.
					res.on("data", () => {});
					res.on("end", () => resolve(classify(res.statusCode ?? 0)));
				},
			);
			req.on("error", () => resolve({ ok: false, reason: "refused" }));
			if (payload) req.write(payload);
			req.end();
		});
	}

	return {
		register: (body) => send("POST", "/connectors/register", body),
		patchSnapshot: (body) =>
			send("PATCH", "/connectors/ai-14all/snapshot", body),
		postEvent: (body) => send("POST", "/connectors/ai-14all/events", body),
		unregister: () => send("DELETE", "/connectors/ai-14all", undefined),
	};
}
