// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	createShellEventLogService,
} from "../../../../services/diagnostics/shell-event-log-service.js";

function makeService(overrides: Partial<Parameters<typeof createShellEventLogService>[0]> = {}) {
	const root = mkdtempSync(join(tmpdir(), "ai14all-shell-log-"));
	return {
		root,
		service: createShellEventLogService({
			userDataPath: root,
			isPackaged: false,
			appVersion: "0.1.0-beta.6",
			now: () => new Date("2026-04-12T00:00:00.000Z"),
			randomId: () => "run_fixed",
			...overrides,
		}),
	};
}

describe("ShellEventLogService", () => {
	it("enables logging in dev mode and writes a jsonl record", () => {
		const { root, service } = makeService();

		service.log({
			source: "main",
			event: "app-log-start",
			windowId: 1,
			data: { mode: "dev" },
		});

		const text = readFileSync(service.getLogPath()!, "utf8").trim();
		expect(text).toContain("\"event\":\"app-log-start\"");
		expect(text).toContain("\"seq\":2");
		expect(text).toContain("\"runId\":\"run_fixed\"");
		expect(root).toBeTruthy();
	});

	it("enables logging in packaged beta builds and disables it in packaged non-beta builds", () => {
		const betaRoot = mkdtempSync(join(tmpdir(), "ai14all-beta-"));
		const prodRoot = mkdtempSync(join(tmpdir(), "ai14all-prod-"));
		const beta = createShellEventLogService({
			userDataPath: betaRoot,
			isPackaged: true,
			appVersion: "0.1.0-beta.7",
		});
		const prod = createShellEventLogService({
			userDataPath: prodRoot,
			isPackaged: true,
			appVersion: "0.1.0",
		});

		expect(beta.isEnabled()).toBe(true);
		expect(prod.isEnabled()).toBe(false);
	});

	it("prunes files older than three days", () => {
		const root = mkdtempSync(join(tmpdir(), "ai14all-shell-log-"));
		const dir = join(root, "diagnostics", "shell-events");
		mkdirSync(dir, { recursive: true });
		const oldPath = join(dir, "2026-04-01T00-00-00.000Z-run_old.jsonl");
		writeFileSync(oldPath, "{}\n");
		utimesSync(oldPath, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));

		createShellEventLogService({
			userDataPath: root,
			isPackaged: false,
			appVersion: "0.1.0-beta.6",
			now: () => new Date("2026-04-12T00:00:00.000Z"),
			randomId: () => "run_prune",
		});

		expect(() => readFileSync(oldPath, "utf8")).toThrow();
	});

	it("emits app-log-pruned with the number of deleted files", () => {
		const root = mkdtempSync(join(tmpdir(), "ai14all-shell-log-"));
		const dir = join(root, "diagnostics", "shell-events");
		mkdirSync(dir, { recursive: true });
		const oldPath = join(dir, "2026-04-01T00-00-00.000Z-run_old.jsonl");
		writeFileSync(oldPath, "{}\n");
		utimesSync(oldPath, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));

		const service = createShellEventLogService({
			userDataPath: root,
			isPackaged: false,
			appVersion: "0.1.0-beta.6",
			now: () => new Date("2026-04-12T00:00:00.000Z"),
			randomId: () => "run_prune_event",
		});

		const lines = readFileSync(service.getLogPath()!, "utf8").trim().split("\n");
		expect(lines.some((line) => line.includes("\"event\":\"app-log-pruned\""))).toBe(true);
		expect(lines.some((line) => line.includes("\"prunedFileCount\":1"))).toBe(true);
	});

	it("truncates payload text and keeps byteLength plus truncated flag", () => {
		const { service } = makeService();
		service.log({
			source: "main",
			event: "terminal-output",
			windowId: 1,
			data: {
				text: "x".repeat(5000),
				hex: Buffer.from("x".repeat(5000), "utf8").toString("hex"),
				byteLength: 5000,
			},
		});

		const lines = readFileSync(service.getLogPath()!, "utf8").trim().split("\n");
		const record = JSON.parse(lines[lines.length - 1]!);
		expect(record.data.truncated).toBe(true);
		expect(record.data.byteLength).toBe(5000);
		expect(record.data.text.length).toBeLessThan(5000);
	});
});
