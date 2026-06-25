// tests/unit/plugins/samantha/samantha-connector-client.test.ts
import { type Server, createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSamanthaConnectorClient } from "../../../../services/plugins/samantha/samantha-connector-client";

let server: Server | null = null;
let port = 0;
const received: { method: string; url: string; body: string }[] = [];

function listen(
	handler: (
		req: import("node:http").IncomingMessage,
		body: string,
	) => { status: number },
): Promise<void> {
	return new Promise((resolve) => {
		server = createServer((req, res) => {
			let body = "";
			req.on("data", (c) => (body += c));
			req.on("end", () => {
				received.push({ method: req.method ?? "", url: req.url ?? "", body });
				const { status } = handler(req, body);
				res.statusCode = status;
				res.end(JSON.stringify({ ok: status < 400 }));
			});
		});
		server.listen(0, "127.0.0.1", () => {
			port = (server!.address() as { port: number }).port;
			resolve();
		});
	});
}

beforeEach(() => {
	received.length = 0;
});

afterEach(async () => {
	if (server) await new Promise((r) => server?.close(() => r(null)));
	server = null;
});

describe("samantha-connector-client", () => {
	it("registers and reports ok on 200", async () => {
		await listen(() => ({ status: 200 }));
		const client = createSamanthaConnectorClient({ port });
		const r = await client.register({
			id: "ai-14all",
			label: "ai-14all",
			description: "ai-14all sessions",
			capabilities: [],
			contractVersion: 1,
		});
		expect(r).toEqual({ ok: true });
		expect(received[0]).toMatchObject({
			method: "POST",
			url: "/connectors/register",
		});
		expect(JSON.parse(received[0].body).id).toBe("ai-14all");
	});

	it("PATCHes the snapshot to the ai-14all connector path", async () => {
		await listen(() => ({ status: 200 }));
		const client = createSamanthaConnectorClient({ port });
		await client.patchSnapshot({
			summary: "s",
			status: "warning",
			details: { "ai-14all/main": "claude · active" },
			updatedAt: 1,
		});
		expect(received[0]).toMatchObject({
			method: "PATCH",
			url: "/connectors/ai-14all/snapshot",
		});
	});

	it("POSTs an event", async () => {
		await listen(() => ({ status: 200 }));
		const client = createSamanthaConnectorClient({ port });
		await client.postEvent({ signal: "attentionRequired", summary: "blocked" });
		expect(received[0]).toMatchObject({
			method: "POST",
			url: "/connectors/ai-14all/events",
		});
	});

	it("maps 404 to not-found and 409 to conflict", async () => {
		await listen((req) => ({ status: req.method === "PATCH" ? 404 : 409 }));
		const client = createSamanthaConnectorClient({ port });
		expect(
			await client.patchSnapshot({
				summary: "",
				status: "ok",
				details: {},
				updatedAt: 0,
			}),
		).toEqual({ ok: false, reason: "not-found" });
		expect(
			await client.register({
				id: "ai-14all",
				label: "ai-14all",
				description: "",
				capabilities: [],
				contractVersion: 1,
			}),
		).toEqual({ ok: false, reason: "conflict" });
	});

	it("maps a refused connection to refused", async () => {
		// No server on this port.
		const client = createSamanthaConnectorClient({ port: 1 });
		const r = await client.patchSnapshot({
			summary: "",
			status: "ok",
			details: {},
			updatedAt: 0,
		});
		expect(r).toEqual({ ok: false, reason: "refused" });
	});

	it("unregisters with DELETE", async () => {
		await listen(() => ({ status: 200 }));
		const client = createSamanthaConnectorClient({ port });
		await client.unregister();
		expect(received[0]).toMatchObject({
			method: "DELETE",
			url: "/connectors/ai-14all",
		});
	});
});
