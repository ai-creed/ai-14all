import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeWhisper } from "../../../services/plugins/whisper/whisper-env-probe";

let dir: string;

function fakeWhisper(body: string): string {
	dir = mkdtempSync(join(tmpdir(), "ofa-envprobe-"));
	const bin = join(dir, "whisper");
	writeFileSync(bin, `#!/bin/sh\n${body}\n`, "utf8");
	chmodSync(bin, 0o755);
	return bin;
}

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const GOOD_ENV = JSON.stringify({
	engineVersion: "0.6.0",
	installPath: "/opt/homebrew/lib/node_modules/ai-whisper",
	stateRoot: "/Users/x/.ai-whisper",
	dbSchemaVersion: 6,
	protocolVersion: "1",
});

describe("probeWhisper", () => {
	it("maps a valid env report to installed", async () => {
		const bin = fakeWhisper(`echo '${GOOD_ENV}'`);
		const result = await probeWhisper(
			{ command: bin, prefixArgs: [] },
			{ timeoutMs: 2000 },
		);
		expect(result).toEqual({
			kind: "installed",
			version: "0.6.0",
			installPath: "/opt/homebrew/lib/node_modules/ai-whisper",
			protocolVersion: "1",
		});
	});

	it("maps unknown-command failure to incompatible (old whisper)", async () => {
		const bin = fakeWhisper('echo "error: unknown command env" >&2; exit 1');
		const result = await probeWhisper(
			{ command: bin, prefixArgs: [] },
			{ timeoutMs: 2000 },
		);
		expect(result).toEqual({
			kind: "incompatible",
			found: "pre-env whisper",
			required: "whisper with `env --json` support",
		});
	});

	it("maps unsupported db schema to incompatible", async () => {
		const report = JSON.stringify({
			...JSON.parse(GOOD_ENV),
			dbSchemaVersion: 7,
		});
		const bin = fakeWhisper(`echo '${report}'`);
		const result = await probeWhisper(
			{ command: bin, prefixArgs: [] },
			{ timeoutMs: 2000 },
		);
		expect(result).toEqual({
			kind: "incompatible",
			found: "db schema 7",
			required: "db schema 6 (update ai-14all)",
		});
	});

	it("maps an older db schema to incompatible (upgrade whisper)", async () => {
		const report = JSON.stringify({
			...JSON.parse(GOOD_ENV),
			dbSchemaVersion: 5,
		});
		const bin = fakeWhisper(`echo '${report}'`);
		const result = await probeWhisper(
			{ command: bin, prefixArgs: [] },
			{ timeoutMs: 2000 },
		);
		expect(result).toEqual({
			kind: "incompatible",
			found: "db schema 5",
			required: "db schema 6 (upgrade whisper)",
		});
	});

	// `not-installed` is owned solely by the driver's `binary === null` check.
	// By the time probeWhisper runs, the binary was resolved (it exists), so
	// every failure is "present but unusable" → degraded, never not-installed.
	// Otherwise a transient probe hiccup shows a misleading Install button.

	it("maps garbage stdout to degraded", async () => {
		const bin = fakeWhisper('echo "not json at all"');
		expect(
			await probeWhisper({ command: bin, prefixArgs: [] }, { timeoutMs: 2000 }),
		).toEqual({
			kind: "degraded",
			reason: "`whisper env --json` returned unreadable output",
		});
	});

	it("maps timeout to degraded", async () => {
		const bin = fakeWhisper("sleep 30");
		expect(
			await probeWhisper({ command: bin, prefixArgs: [] }, { timeoutMs: 100 }),
		).toEqual({
			kind: "degraded",
			reason: "could not run `whisper env --json`",
		});
	});

	it("maps an un-runnable binary (e.g. missing node interpreter) to degraded", async () => {
		// Mirrors the real bug: the binary resolves but its `#!/usr/bin/env node`
		// shebang can't find node, so the exec fails — present, not absent.
		expect(
			await probeWhisper(
				{ command: "/nope/whisper", prefixArgs: [] },
				{ timeoutMs: 2000 },
			),
		).toEqual({
			kind: "degraded",
			reason: "could not run `whisper env --json`",
		});
	});
});
