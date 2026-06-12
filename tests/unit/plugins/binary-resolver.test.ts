import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBinary } from "../../../services/plugins/binary-resolver";

let dir: string;

function makeDir(): string {
	dir = mkdtempSync(join(tmpdir(), "ofa-binres-"));
	return dir;
}

function writeFakeShell(body: string): string {
	const shell = join(makeDir(), "fake-shell.sh");
	writeFileSync(shell, `#!/bin/sh\n${body}\n`, "utf8");
	chmodSync(shell, 0o755);
	return shell;
}

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("resolveBinary", () => {
	it("resolves via the login shell and returns a direct-spawn spec", async () => {
		const shell = writeFakeShell('echo "/fake/bin/whisper"');
		const result = await resolveBinary("whisper", { shell, timeoutMs: 2000 });
		expect(result).toEqual({ command: "/fake/bin/whisper", prefixArgs: [] });
	});

	it("returns null when the shell finds nothing", async () => {
		const shell = writeFakeShell("exit 1");
		expect(
			await resolveBinary("whisper", { shell, timeoutMs: 2000 }),
		).toBeNull();
	});

	it("returns null on garbage output instead of throwing", async () => {
		const shell = writeFakeShell('echo "zsh: command not found: whisper"');
		expect(
			await resolveBinary("whisper", { shell, timeoutMs: 2000 }),
		).toBeNull();
	});

	it("returns null on timeout", async () => {
		const shell = writeFakeShell("sleep 30");
		expect(
			await resolveBinary("whisper", { shell, timeoutMs: 100 }),
		).toBeNull();
	});

	it("override: executable file is used directly", async () => {
		const file = join(makeDir(), "whisper");
		writeFileSync(file, "#!/bin/sh\n", "utf8");
		chmodSync(file, 0o755);
		const result = await resolveBinary("whisper", {
			shell: "/bin/sh",
			timeoutMs: 2000,
			installPath: file,
		});
		expect(result).toEqual({ command: file, prefixArgs: [] });
	});

	it("override: directory resolves to node + dev-checkout entry", async () => {
		const root = makeDir();
		const entry = join(root, "packages/cli/dist/bin/whisper.js");
		mkdirSync(join(root, "packages/cli/dist/bin"), { recursive: true });
		writeFileSync(entry, "", "utf8");
		const result = await resolveBinary("whisper", {
			shell: "/bin/sh",
			timeoutMs: 2000,
			installPath: root,
		});
		expect(result).toEqual({
			command: process.execPath,
			prefixArgs: [entry],
		});
	});

	it("override: missing path yields null (not PATH fallback)", async () => {
		const result = await resolveBinary("whisper", {
			shell: "/bin/sh",
			timeoutMs: 2000,
			installPath: join(makeDir(), "nope"),
		});
		expect(result).toBeNull();
	});
});
