#!/usr/bin/env node
// scripts/hero/agent-player.mjs — plays a transcript through the real PTY.
import { readFileSync, appendFileSync } from "node:fs";
import { parseTranscript, play } from "./transcript-player.mjs";

const arg = (name) => {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
};
const transcriptPath = arg("--transcript");
const title = arg("--title");
const loop = process.argv.includes("--loop");
if (!transcriptPath) {
	console.error(
		"usage: agent-player --transcript <path> [--title <name>] [--loop]",
	);
	process.exit(2);
}
if (title) process.stdout.write(`\x1b]0;${title}\x07`); // OSC-0 → provider badge

// In-place idle spinner: each tick rewrites the same terminal cell instead of
// accumulating braille glyphs across the screen during long parked waits.
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

const io = {
	write: (s) => process.stdout.write(s),
	appendMark: (marker, t) => {
		if (process.env.HERO_MARKS_PATH)
			appendFileSync(
				process.env.HERO_MARKS_PATH,
				JSON.stringify({ marker, t }) + "\n",
			);
	},
	now: () => Date.now(),
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	waitGate: async (name, idle) => {
		const dir = process.env.HERO_GATE_DIR;
		if (dir) {
			const { existsSync, writeFileSync } = await import("node:fs");
			const { join } = await import("node:path");
			// READY HANDSHAKE: prove we are parked here before the recorder may start M0.
			writeFileSync(join(dir, `${name}.waiting`), String(Date.now()));
			let lastIdle = Date.now();
			let spinnerIndex = idle ? Math.max(0, SPINNER.indexOf(idle.chunk)) : 0;
			while (!existsSync(join(dir, name))) {
				await new Promise((r) => setTimeout(r, 25));
				if (idle && Date.now() - lastIdle >= idle.everyMs) {
					process.stdout.write(`\r${SPINNER[spinnerIndex]}`);
					spinnerIndex = (spinnerIndex + 1) % SPINNER.length;
					lastIdle = Date.now();
				}
			}
		} // else: no recorder driving us (manual playback) — pass through
		process.stdout.write("\n"); // gate open — burst starts on a fresh line
	},
};
const items = parseTranscript(readFileSync(transcriptPath, "utf8"));
do {
	await play(items, io);
} while (loop);
