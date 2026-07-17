import { describe, expect, it } from "vitest";
import {
	TERMINAL_SCROLLBACK_ROWS,
	TERMINAL_SPAWN_COLS,
	TERMINAL_SPAWN_ROWS,
} from "../../../shared/constants/terminal-geometry";

describe("terminal geometry constants", () => {
	it("pins the spec values", () => {
		expect(TERMINAL_SCROLLBACK_ROWS).toBe(10_000);
		expect(TERMINAL_SPAWN_COLS).toBe(80);
		expect(TERMINAL_SPAWN_ROWS).toBe(24);
	});
});
