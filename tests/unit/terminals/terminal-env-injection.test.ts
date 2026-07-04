// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TERMINAL_SESSION_ENV_VAR } from "../../../shared/contracts/terminal-env.js";
import { TerminalService } from "../../../services/terminals/terminal-service.js";

describe("TERMINAL_SESSION_ENV_VAR", () => {
	it("is the documented name", () => {
		expect(TERMINAL_SESSION_ENV_VAR).toBe("AI14ALL_TERMINAL_SESSION_ID");
	});
});

describe("TerminalService PTY env injection", () => {
	// The spawned shell is a real login shell (see resolveDefaultShell). A
	// user's local zshrc can print banners/titles/prompts that don't break the
	// `.toContain` assertion but do make local runs flaky and hard to debug —
	// point ZDOTDIR at an empty dir so zsh loads no rc files, mirroring a
	// clean CI shell (see mem: local-e2e-shell-flakes-neutralize-zsh).
	let zdotdir: string;
	let originalZdotdir: string | undefined;

	beforeEach(() => {
		zdotdir = mkdtempSync(join(tmpdir(), "ai14all-zdotdir-"));
		originalZdotdir = process.env.ZDOTDIR;
		process.env.ZDOTDIR = zdotdir;
	});

	afterEach(() => {
		if (originalZdotdir === undefined) {
			delete process.env.ZDOTDIR;
		} else {
			process.env.ZDOTDIR = originalZdotdir;
		}
		rmSync(zdotdir, { recursive: true, force: true });
	});

	it("injects the terminal session id into the PTY env", async () => {
		const outputs: string[] = [];
		const svc = new TerminalService({
			onOutput: (_id, data) => outputs.push(data),
			onExit: () => {},
			onState: () => {},
			onError: () => {},
		});

		const meta = svc.create("ws-test", "wt-test", "/tmp");
		try {
			expect(meta.status).not.toBe("error");
			svc.sendInput(meta.id, `echo VAR=$${TERMINAL_SESSION_ENV_VAR}\n`);
			await expect
				.poll(() => outputs.join(""), { timeout: 10_000 })
				.toContain(`VAR=${meta.id}`);
		} finally {
			svc.stop(meta.id);
		}
	});
});
