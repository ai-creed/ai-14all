import { describe, expect, it } from "vitest";
import {
	appendBoundedReplay,
	recordReplayOutput,
	getReplayOutput,
	clearReplayOutput,
} from "../../../src/features/terminals/logic/replay-buffer";

describe("appendBoundedReplay", () => {
	it("concatenates when the result stays within the limit", () => {
		expect(appendBoundedReplay("abc", "def", 10)).toBe("abcdef");
	});

	it("keeps at most `limit` characters when exceeded", () => {
		// No newline to trim at, so the raw last `limit` chars are kept.
		const result = appendBoundedReplay("aaaa", "bbbb", 5);
		expect(result.length).toBeLessThanOrEqual(5);
		expect(result).toBe("abbbb");
	});

	it("trims at a line boundary so a replay starts on a fresh line", () => {
		// 12 chars total, limit 8 → last 8 = "3\nline4\n"; drop the partial
		// leading "3" fragment up to the first newline → "line4\n".
		const result = appendBoundedReplay("line1\nline2\n", "line3\nline4\n", 8);
		expect(result).toBe("line4\n");
	});

	it("falls back to the raw tail when the trimmed window has no usable newline", () => {
		// The only newline is the last char, so there is no fresh line to start
		// from; keep the raw last `limit` chars rather than returning empty.
		const result = appendBoundedReplay("", "abcdefgh\n", 4);
		expect(result).toBe("fgh\n");
	});
});

describe("replay buffer store", () => {
	it("accumulates per session and replays the concatenation", () => {
		const id = "session-accumulate";
		clearReplayOutput(id);
		recordReplayOutput(id, "hello ");
		recordReplayOutput(id, "world");
		expect(getReplayOutput(id)).toBe("hello world");
		clearReplayOutput(id);
	});

	it("isolates buffers by session id", () => {
		clearReplayOutput("s-a");
		clearReplayOutput("s-b");
		recordReplayOutput("s-a", "AAA");
		recordReplayOutput("s-b", "BBB");
		expect(getReplayOutput("s-a")).toBe("AAA");
		expect(getReplayOutput("s-b")).toBe("BBB");
		clearReplayOutput("s-a");
		clearReplayOutput("s-b");
	});

	it("ignores empty writes and returns empty for unknown/cleared sessions", () => {
		const id = "session-clear";
		recordReplayOutput(id, "");
		expect(getReplayOutput(id)).toBe("");
		recordReplayOutput(id, "data");
		clearReplayOutput(id);
		expect(getReplayOutput(id)).toBe("");
	});
});
