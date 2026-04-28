// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CliOverrideStore } from "../../../services/review/agent-skill-installer/cli-override-store.js";

describe("CliOverrideStore", () => {
	let dir: string;
	let file: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "cli-override-"));
		file = join(dir, "cli-overrides.json");
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("load returns empty object when file missing", async () => {
		const store = new CliOverrideStore(file);
		expect(await store.load()).toEqual({});
	});

	it("load returns empty object when file is corrupt JSON", async () => {
		await writeFile(file, "{not valid", "utf-8");
		const store = new CliOverrideStore(file);
		expect(await store.load()).toEqual({});
	});

	it("load returns empty object when schema validation fails", async () => {
		await writeFile(file, JSON.stringify({ "claude-code": 42 }), "utf-8");
		const store = new CliOverrideStore(file);
		expect(await store.load()).toEqual({});
	});

	it("set persists a path and load round-trips", async () => {
		const store = new CliOverrideStore(file);
		await store.set("claude-code", "/Users/x/.claude/local/claude");
		const next = await store.load();
		expect(next["claude-code"]).toBe("/Users/x/.claude/local/claude");
	});

	it("set null clears that provider only", async () => {
		const store = new CliOverrideStore(file);
		await store.set("claude-code", "/a");
		await store.set("codex", "/b");
		await store.set("claude-code", null);
		const next = await store.load();
		expect(next["claude-code"]).toBeNull();
		expect(next["codex"]).toBe("/b");
	});

	it("set writes atomically (no temp file remains on success)", async () => {
		const store = new CliOverrideStore(file);
		await store.set("claude-code", "/a");
		const persisted = await readFile(file, "utf-8");
		expect(JSON.parse(persisted)).toEqual({ "claude-code": "/a" });
		// Verify no leftover temp files
		const entries = await readdir(dirname(file));
		expect(entries.some((e) => e.includes(".tmp-"))).toBe(false);
	});
});
