import { describe, expect, it } from "vitest";
import {
	parseTranscript,
	play,
} from "../../../scripts/hero/transcript-player.mjs";

const mkIo = () => {
	const writes: string[] = [];
	const marks: Array<{ marker: string; t: number }> = [];
	let clock = 0;
	return {
		io: {
			write: (s: string) => void writes.push(s),
			appendMark: (marker: string, t: number) => void marks.push({ marker, t }),
			now: () => clock,
			sleep: async (ms: number) => void (clock += ms),
		},
		writes,
		marks,
		time: () => clock,
	};
};

describe("transcript player", () => {
	it("parses text, chunk, and marker items", () => {
		const items = parseTranscript(
			'{"delayMs":100,"text":"hello"}\n{"delayMs":30,"chunk":"tok"}\n{"delayMs":0,"text":"done","marker":"m1"}\n',
		);
		expect(items).toHaveLength(3);
		expect(items[1]).toEqual({ delayMs: 30, chunk: "tok" });
	});

	it("honors delays sequentially and stamps markers at emission time", async () => {
		const { io, writes, marks, time } = mkIo();
		await play(
			parseTranscript(
				'{"delayMs":100,"text":"a"}\n{"delayMs":50,"text":"b","marker":"commit-line"}\n',
			),
			io,
		);
		expect(writes).toEqual(["a\n", "b\n"]);
		expect(marks).toEqual([{ marker: "commit-line", t: 150 }]);
		expect(time()).toBe(150);
	});

	it("chunks write without newline", async () => {
		const { io, writes } = mkIo();
		await play(
			parseTranscript(
				'{"delayMs":10,"chunk":"to"}\n{"delayMs":10,"chunk":"ken"}\n',
			),
			io,
		);
		expect(writes).toEqual(["to", "ken"]);
	});

	it("a gate item parks with idle config until waitGate resolves, then the marker lands at a fixed offset", async () => {
		const { io, marks, time } = mkIo();
		let received: unknown;
		const gated = {
			...io,
			waitGate: async (
				name: string,
				idle?: { chunk: string; everyMs: number },
			) => {
				expect(name).toBe("fleet-burst");
				received = idle;
				io.sleep(3000); // simulate a long, variable arrange phase
			},
		};
		await play(
			parseTranscript(
				'{"delayMs":100,"text":"ambient"}\n{"delayMs":0,"gate":"fleet-burst","idleChunk":"⠙","idleEveryMs":150}\n{"delayMs":800,"text":"commit","marker":"commit-line"}\n',
			),
			gated,
		);
		// idle config is passed through so the CLI can keep the terminal alive
		expect(received).toEqual({ chunk: "⠙", everyMs: 150 });
		// marker time = gate-open time + exactly 800ms, regardless of the wait
		expect(marks).toEqual([{ marker: "commit-line", t: 100 + 3000 + 800 }]);
		expect(time()).toBe(3900);
	});
});
