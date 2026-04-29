import { describe, expect, it } from "vitest";
import { consumeOutputPreview } from "../../../src/features/terminals/logic/output-preview";

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

	it("strips OSC sequences and does not treat their body as visible text", () => {
		// Shell prompts emit OSC title/cwd sequences like ESC]2;user@host:/path BEL.
		// The body must not surface as process context in the sidebar.
		expect(
			consumeOutputPreview(
				"",
				"compiled in 124ms\n\u001b]2;vuphan@host:/tmp/repo\u0007\u001b]7;file:///tmp/repo\u0007\n",
			),
		).toEqual({
			nextBuffer: "",
			preview: "compiled in 124ms",
		});
	});

	it("collapses whitespace and truncates long lines", () => {
		const result = consumeOutputPreview(
			"",
			"build    succeeded    after    a    surprisingly    long    amount    of    time\n",
		);
		expect(result.preview).toBe(
			"build succeeded after a surprisingly long am...",
		);
	});
});
