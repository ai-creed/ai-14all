import { describe, expect, it } from "vitest";
import { consumeOutputPreview } from "../../../src/features/terminals/output-preview";

describe("consumeOutputPreview", () => {
	it("extracts the last complete visible line and strips ANSI codes", () => {
		expect(
			consumeOutputPreview("", "\u001b[32mcompiled in 124ms\u001b[0m\n"),
		).toEqual({
			nextBuffer: "",
			preview: "compiled in 124ms",
		});
	});

	it("retains an unterminated fragment until the next chunk completes it", () => {
		const first = consumeOutputPreview("", "Compiling modu");
		expect(first).toEqual({
			nextBuffer: "Compiling modu",
			preview: undefined,
		});

		const second = consumeOutputPreview(
			first.nextBuffer,
			"les...\nDone in 42ms\n",
		);
		expect(second).toEqual({
			nextBuffer: "",
			preview: "Done in 42ms",
		});
	});

	it("ignores blank or noise-only lines", () => {
		expect(consumeOutputPreview("", "\n   \n-----\n")).toEqual({
			nextBuffer: "",
			preview: undefined,
		});
	});

	it("collapses whitespace and truncates long lines", () => {
		const result = consumeOutputPreview(
			"",
			"build    succeeded    after    a    surprisingly    long    amount    of    time\n",
		);
		expect(result.preview).toBe("build succeeded after a surprisingly long am...");
	});
});
