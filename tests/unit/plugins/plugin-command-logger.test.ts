import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginCommandLogger } from "../../../services/diagnostics/plugin-command-logger";

let dir: string;

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("PluginCommandLogger", () => {
	it("appends one JSON line per command", () => {
		dir = mkdtempSync(join(tmpdir(), "ofa-cmdlog-"));
		const logger = new PluginCommandLogger({ logsDir: dir });
		logger.append({
			ts: 123,
			plugin: "whisper",
			argv: ["workflow", "pause", "wf1"],
			cwd: "/w1",
			exitCode: 0,
			durationMs: 40,
			stderrSample: "",
		});
		const lines = readFileSync(join(dir, "plugin-commands.jsonl"), "utf8")
			.trim()
			.split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0])).toMatchObject({
			plugin: "whisper",
			argv: ["workflow", "pause", "wf1"],
			exitCode: 0,
		});
	});

	it("never throws when the directory is unwritable (file blocks dir creation)", () => {
		dir = mkdtempSync(join(tmpdir(), "ofa-cmdlog-"));
		// Create a file at "blocker" so mkdirSync("blocker/sub") throws ENOTDIR
		writeFileSync(join(dir, "blocker"), "x");
		const logger = new PluginCommandLogger({
			logsDir: join(dir, "blocker", "sub"),
		});
		expect(() =>
			logger.append({
				ts: 1,
				plugin: "whisper",
				argv: [],
				cwd: "/",
				exitCode: null,
				durationMs: 0,
				stderrSample: "",
			}),
		).not.toThrow();
	});
});
