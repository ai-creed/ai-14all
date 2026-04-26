import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadOrPickPort,
	writeLivenessFile,
	deleteLivenessFile,
} from "../../../services/review/mcp-port-config";

describe("mcp-port-config", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "mcp-port-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("first call picks a port and persists it", async () => {
		const cfgPath = join(dir, "mcp-config.json");
		const port = await loadOrPickPort(cfgPath, { rangeStart: 51000, rangeEnd: 51999 });
		expect(port).toBeGreaterThanOrEqual(51000);
		expect(port).toBeLessThanOrEqual(51999);
		const written = JSON.parse(await readFile(cfgPath, "utf-8"));
		expect(written.port).toBe(port);
	});

	it("subsequent call returns the persisted port", async () => {
		const cfgPath = join(dir, "mcp-config.json");
		await writeFile(cfgPath, JSON.stringify({ port: 51234 }), "utf-8");
		const port = await loadOrPickPort(cfgPath, { rangeStart: 51000, rangeEnd: 51999 });
		expect(port).toBe(51234);
	});

	it("liveness file is written / deleted with the port number", async () => {
		const livePath = join(dir, "mcp-port");
		await writeLivenessFile(livePath, 51234);
		expect(await readFile(livePath, "utf-8")).toBe("51234");
		await deleteLivenessFile(livePath);
	});
});
