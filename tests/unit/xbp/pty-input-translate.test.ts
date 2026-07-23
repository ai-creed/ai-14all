import { describe, expect, it } from "vitest";
import { translatePtyInputChunks } from "../../../services/xbp/pty-input-translate";

describe("translatePtyInputChunks (normative table, child spec §3)", () => {
	it("maps each named key to its exact byte sequence", () => {
		expect(translatePtyInputChunks([{ key: "enter" }])).toBe("\r");
		expect(translatePtyInputChunks([{ key: "up" }])).toBe("\x1b[A");
		expect(translatePtyInputChunks([{ key: "down" }])).toBe("\x1b[B");
		expect(translatePtyInputChunks([{ key: "esc" }])).toBe("\x1b");
		expect(translatePtyInputChunks([{ key: "ctrl-c" }])).toBe("\x03");
	});

	it("passes text through verbatim (UTF-8 write happens at the PTY boundary)", () => {
		expect(translatePtyInputChunks([{ text: "echo héllo 🚀" }])).toBe(
			"echo héllo 🚀",
		);
	});

	it("preserves order across a mixed list as ONE string (single contiguous write)", () => {
		expect(
			translatePtyInputChunks([
				{ text: "y" },
				{ key: "enter" },
				{ key: "up" },
				{ text: "continue" },
			]),
		).toBe("y\r\x1b[Acontinue");
	});
});
