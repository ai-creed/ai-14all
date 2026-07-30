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
		if (!dir) return; // no recorder driving us (manual playback) — pass through
		const { existsSync, writeFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		// READY HANDSHAKE: prove we are parked here before the recorder may start M0.
		writeFileSync(join(dir, `${name}.waiting`), String(Date.now()));
		let lastIdle = Date.now();
		while (!existsSync(join(dir, name))) {
			await new Promise((r) => setTimeout(r, 25));
			if (idle && Date.now() - lastIdle >= idle.everyMs) {
				process.stdout.write(idle.chunk);
				lastIdle = Date.now();
			}
		}
	},
};
const items = parseTranscript(readFileSync(transcriptPath, "utf8"));
do {
	await play(items, io);
} while (loop);
