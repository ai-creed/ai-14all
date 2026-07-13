import { afterEach, describe, expect, it } from "vitest";
import { once } from "node:events";
import { request } from "node:http";
import WebSocket from "ws";
import {
	startMockSamantha,
	type MockSamantha,
} from "../../../e2e/fixtures/samantha-mock-server";

let mock: MockSamantha | undefined;
afterEach(async () => {
	await mock?.close();
	mock = undefined;
});

function httpStatus(
	port: number,
	method: string,
	path: string,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				path,
				method,
				headers: { "content-type": "application/json", "content-length": 2 },
			},
			(res) => {
				res.on("data", () => {});
				res.on("end", () => resolve(res.statusCode ?? 0));
			},
		);
		req.on("error", reject);
		req.write("{}");
		req.end();
	});
}

async function openClient(port: number): Promise<WebSocket> {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/connectors/ai-14all/events`);
	// Raw test client: swallow benign handshake/teardown errors so they don't
	// surface as unhandled (e.g. the server terminate() during afterEach).
	ws.on("error", () => {});
	// Wait for CONNECTING -> OPEN before we close/drop it. waitForConnection only
	// observes the server side, which fires before the client finishes its
	// handshake; closing a CONNECTING socket makes ws throw "WebSocket was closed
	// before the connection was established".
	await once(ws, "open");
	return ws;
}

describe("samantha-mock-server (S4 extensions)", () => {
	it("counts connections and supports waitForConnection", async () => {
		mock = await startMockSamantha();
		expect(mock.connectionCount).toBe(0);
		const ws = await openClient(mock.port);
		await mock.waitForConnection(1);
		expect(mock.connectionCount).toBe(1);
		ws.close();
	});

	it("dropSocket closes the active connector socket", async () => {
		mock = await startMockSamantha();
		const ws = await openClient(mock.port);
		const closed = new Promise<void>((resolve) =>
			ws.on("close", () => resolve()),
		);
		await mock.waitForConnection(1);
		mock.dropSocket();
		await closed; // resolves only if the server closed the socket
	});

	it("forgetRegistration makes snapshot/event 404 until a fresh register", async () => {
		mock = await startMockSamantha();
		expect(
			await httpStatus(mock.port, "PATCH", "/connectors/ai-14all/snapshot"),
		).toBe(200);
		mock.forgetRegistration();
		expect(
			await httpStatus(mock.port, "PATCH", "/connectors/ai-14all/snapshot"),
		).toBe(404);
		expect(
			await httpStatus(mock.port, "POST", "/connectors/ai-14all/events"),
		).toBe(404);
		expect(await httpStatus(mock.port, "POST", "/connectors/register")).toBe(
			200,
		);
		expect(
			await httpStatus(mock.port, "PATCH", "/connectors/ai-14all/snapshot"),
		).toBe(200);
	});

	it("restart() re-listens on the same port", async () => {
		mock = await startMockSamantha();
		const port = mock.port;
		await mock.stop();
		await mock.restart();
		expect(mock.port).toBe(port);
		expect(await httpStatus(mock.port, "POST", "/connectors/register")).toBe(
			200,
		);
	});
});
