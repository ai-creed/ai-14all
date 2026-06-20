/**
 * The control byte that submits a typed command line to a PTY-backed shell.
 *
 * On Windows the PTY is ConPTY driving PowerShell/cmd, which runs a line only
 * when it receives a carriage return (`\r`); a bare line feed (`\n`) leaves the
 * command sitting at the prompt, typed-but-unexecuted (the bug where launch
 * buttons "type but don't run"). POSIX PTYs (macOS, Linux) submit on either,
 * because the tty line discipline maps CR→LF via `ICRNL`.
 *
 * We therefore send `\r` ONLY on Windows and keep `\n` everywhere else, so
 * macOS/Linux input is byte-for-byte identical to before this fix — no risk of
 * behavioural regression on those platforms.
 *
 * `platform` defaults to `navigator.platform` (the same signal the rest of the
 * renderer uses for OS detection) and is injectable for tests.
 */
export function commandSubmitKey(
	platform: string = typeof navigator === "undefined" ? "" : navigator.platform,
): "\r" | "\n" {
	return /win/i.test(platform) ? "\r" : "\n";
}
