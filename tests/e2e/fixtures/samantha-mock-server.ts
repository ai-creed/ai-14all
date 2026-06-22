import { type Server, createServer } from "node:http";

export type MockSamantha = {
	port: number;
	requests: { method: string; url: string; body: unknown }[];
	close(): Promise<void>;
};

export async function startMockSamantha(): Promise<MockSamantha> {
	const requests: MockSamantha["requests"] = [];
	const server: Server = createServer((req, res) => {
		let raw = "";
		req.on("data", (c) => (raw += c));
		req.on("end", () => {
			requests.push({
				method: req.method ?? "",
				url: req.url ?? "",
				body: raw ? JSON.parse(raw) : null,
			});
			res.statusCode = 200;
			res.end(JSON.stringify({ ok: true }));
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
	const port = (server.address() as { port: number }).port;
	return {
		port,
		requests,
		close: () => new Promise((r) => server.close(() => r())),
	};
}
