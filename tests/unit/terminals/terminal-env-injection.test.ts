// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TERMINAL_SESSION_ENV_VAR } from "../../../shared/contracts/terminal-env.js";
import { TerminalService } from "../../../services/terminals/terminal-service.js";

/** Poll `pred` until true or `timeoutMs` elapses; resolves either way (a stuck
 *  shell must not hang the suite — the retrying rmSync is the backstop). */
async function waitUntil(
	pred: () => boolean,
	timeoutMs: number,
): Promise<void> {
	const start = Date.now();
	while (!pred() && Date.now() - start < timeoutMs) {
		await new Promise((r) => setTimeout(r, 25));
	}
}

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
		// stop() only sends an async PTY kill, so the login shell may still be
		// exiting (and zsh may still be writing .zsh_history/.zcompdump into
		// ZDOTDIR) when we get here. The test awaits the exit event before this
		// runs; retrying is the backstop for a shell that hasn't fully released
		// the dir yet, so a lingering write can't turn cleanup into ENOTEMPTY.
		rmSync(zdotdir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	});

	it("injects the terminal session id into the PTY env", async () => {
		const outputs: string[] = [];
		const exited = new Set<string>();
		const svc = new TerminalService({
			onOutput: (_id, data) => outputs.push(data),
			onExit: (id) => {
				exited.add(id);
			},
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
			// stop() only fires an async PTY kill; wait for the shell to actually
			// exit before afterEach removes ZDOTDIR so the still-exiting shell can't
			// race the cleanup. Tolerate a timeout — the retrying rmSync backstops.
			await waitUntil(() => exited.has(meta.id), 5000);
		}
	});
});
