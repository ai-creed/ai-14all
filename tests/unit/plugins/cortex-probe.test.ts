import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeCortex } from "../../../services/plugins/cortex/cortex-probe";

let dir: string;

function fakeCortex(body: string): string {
	dir = mkdtempSync(join(tmpdir(), "ofa-cortexprobe-"));
	const bin = join(dir, "ai-cortex");
	writeFileSync(bin, `#!/bin/sh\n${body}\n`, "utf8");
	chmodSync(bin, 0o755);
	return bin;
}

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("probeCortex", () => {
	it("null binary → not-installed", async () => {
		dir = mkdtempSync(join(tmpdir(), "ofa-cortexprobe-")); // for afterEach cleanup
		expect(await probeCortex(null)).toEqual({ kind: "not-installed" });
	});

	it("maps `ai-cortex 0.15.1` to installed with parsed version", async () => {
		const bin = fakeCortex("echo 'ai-cortex 0.15.1'");
		expect(
			await probeCortex({ command: bin, prefixArgs: [] }, { timeoutMs: 2000 }),
		).toEqual({
			kind: "installed",
			version: "0.15.1",
			installPath: bin,
			protocolVersion: "",
		});
	});

	it("tolerates a v-prefix and trailing build metadata", async () => {
		const bin = fakeCortex("echo 'ai-cortex v0.16.0-beta.1 (build 42)'");
		expect(
			await probeCortex({ command: bin, prefixArgs: [] }, { timeoutMs: 2000 }),
		).toMatchObject({ kind: "installed", version: "0.16.0-beta.1" });
	});

	it("maps unreadable output to degraded", async () => {
		const bin = fakeCortex("echo 'no version here'");
		expect(
			await probeCortex({ command: bin, prefixArgs: [] }, { timeoutMs: 2000 }),
		).toEqual({
			kind: "degraded",
			reason: "`ai-cortex --version` returned unreadable output",
		});
	});

	it("maps a timeout / exec failure to degraded", async () => {
		const bin = fakeCortex("sleep 30");
		expect(
			await probeCortex({ command: bin, prefixArgs: [] }, { timeoutMs: 100 }),
		).toEqual({
			kind: "degraded",
			reason: "could not run `ai-cortex --version`",
		});
	});
});
