import { describe, expect, it } from "vitest";
import { commandSubmitKey } from "../../../src/lib/command-submit-key";

describe("commandSubmitKey", () => {
	it("returns CR on Windows (ConPTY needs CR to run the line)", () => {
		expect(commandSubmitKey("Win32")).toBe("\r");
	});

	it("returns LF on macOS — unchanged from pre-Windows-fix behaviour", () => {
		expect(commandSubmitKey("MacIntel")).toBe("\n");
	});

	it("returns LF on Linux", () => {
		expect(commandSubmitKey("Linux x86_64")).toBe("\n");
	});

	it("returns LF for the empty platform string (jsdom test env)", () => {
		expect(commandSubmitKey("")).toBe("\n");
	});
});
