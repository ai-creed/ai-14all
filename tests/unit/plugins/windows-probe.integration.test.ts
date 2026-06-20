import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBinary } from "../../../services/plugins/binary-resolver";
import { probeCortex } from "../../../services/plugins/cortex/cortex-probe";
import { probeWhisper } from "../../../services/plugins/whisper/whisper-env-probe";

// Windows-only: these create real `.cmd` shims and execute them, so they prove
// the full resolve -> adaptResolvedExec -> cmd.exe -> probe chain that the
// CVE-2024-27980 hardening + the extensionless-`where`-shim ordering broke.
// `.cmd` files only run on Windows, so the suite is skipped elsewhere; the
// cross-platform logic is covered by pickWindowsExecutable / adaptResolvedExec
// unit tests that inject `platform: "win32"`.
const onWindows = process.platform === "win32";

let dir: string;
afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

function makeNpmStyleShim(name: string, batchBody: string): string {
	dir = mkdtempSync(join(tmpdir(), "ofa-winprobe-"));
	const binDir = join(dir, "npm");
	mkdirSync(binDir);
	// The extensionless POSIX shim npm also installs — must NOT be the one picked.
	writeFileSync(join(binDir, name), "#!/bin/sh\n", "utf8");
	writeFileSync(
		join(binDir, `${name}.cmd`),
		`@echo off\r\n${batchBody}\r\n`,
		"utf8",
	);
	return binDir;
}

describe.runIf(onWindows)("windows plugin probes (real .cmd execution)", () => {
	it("resolves ai-cortex to its .cmd and probeCortex reports installed", async () => {
		const binDir = makeNpmStyleShim("ai-cortex", "echo ai-cortex 9.9.9");
		const resolved = await resolveBinary("ai-cortex", {
			platform: "win32",
			whichOnPath: async () => null,
			searchPaths: [binDir],
		});
		expect(resolved?.command).toBe(join(binDir, "ai-cortex.cmd"));

		const result = await probeCortex(resolved, { timeoutMs: 10_000 });
		expect(result).toMatchObject({ kind: "installed", version: "9.9.9" });
	});

	it("resolves whisper to its .cmd and probeWhisper parses env --json", async () => {
		const json =
			'{"engineVersion":"1.2.3","installPath":"x","stateRoot":"y","dbSchemaVersion":6,"protocolVersion":"1"}';
		const binDir = makeNpmStyleShim("whisper", `echo ${json}`);
		const resolved = await resolveBinary("whisper", {
			platform: "win32",
			whichOnPath: async () => null,
			searchPaths: [binDir],
		});
		expect(resolved?.command).toBe(join(binDir, "whisper.cmd"));

		// biome-ignore lint/style/noNonNullAssertion: asserted resolved above.
		const result = await probeWhisper(resolved!, { timeoutMs: 10_000 });
		expect(result).toMatchObject({ kind: "installed", version: "1.2.3" });
	});

	it("a degraded shim (.cmd that errors) is reported as degraded, not installed", async () => {
		const binDir = makeNpmStyleShim("ai-cortex", "exit /b 1");
		const resolved = await resolveBinary("ai-cortex", {
			platform: "win32",
			whichOnPath: async () => null,
			searchPaths: [binDir],
		});
		const result = await probeCortex(resolved, { timeoutMs: 10_000 });
		expect(result).toMatchObject({ kind: "degraded" });
	});
});
